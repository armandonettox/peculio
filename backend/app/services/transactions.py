import uuid
from collections import defaultdict
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams
from app.models.account import Account, AccountType
from app.models.attachment import Attachment
from app.models.category import Category
from app.models.currency import Currency
from app.models.tag import Tag
from app.models.transaction import Transaction, TransactionSplit, TransactionType, transaction_split_tags
from app.models.user import User
from app.models.webhook import WebhookEvent
from app.schemas.transaction import TransactionCreate, TransactionOut, TransactionSplitCreate
from app.services.clearings import assert_unlocked, capture_clearings, clearing_states, restore_clearings
from app.services.accounts import check_amount, get_currency, get_owned_account, quantize_money
from app.services.attachment_storage import storage_path
from app.services.bills import find_matching_bill, get_owned_bill
from app.services.budgets import get_owned_budget
from app.services.rule_defs import load_rule_defs
from app.services.rules_engine import Fill, RuleDef, SplitFacts, apply_rules
from app.services.webhooks import enqueue_event

# Conta de contraparte criada automaticamente com esse tipo, conforme o sentido da transacao
COUNTERPARTY_TYPE = {"withdrawal": AccountType.expense, "deposit": AccountType.revenue}

# Contrapartes aceitas quando o usuario informa uma conta que ja existe. Pagar uma divida e
# um saque para uma conta de passivo; receber um emprestimo e um deposito vindo dela.
ALLOWED_COUNTERPARTIES = {
    "withdrawal": (AccountType.expense, AccountType.liability),
    "deposit": (AccountType.revenue, AccountType.liability),
}

SYSTEM_TYPES = (AccountType.initial_balance, AccountType.reconciliation)
USER_SIDE_TYPES = (AccountType.asset, AccountType.liability)
# So estes tipos aparecem na lista de transacoes (saldo inicial e conciliacao sao do sistema)
LISTED_TYPES = (TransactionType.withdrawal, TransactionType.deposit, TransactionType.transfer)


# ---------- Validacoes e contas ----------


def get_owned_counterparty(db: Session, user_id: uuid.UUID, account_id: uuid.UUID) -> Account:
    """Conta do usuario de qualquer tipo (inclusive despesa/receita), menos as de sistema."""
    account = db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.user_id == user_id,
            Account.type.notin_(SYSTEM_TYPES),
        )
    ).scalar_one_or_none()
    if not account:
        raise AppError(404, ErrorCode.ACCOUNT_NOT_FOUND, "Conta nao encontrada")
    return account


def get_or_create_counterparty(
    db: Session, user_id: uuid.UUID, account_type: AccountType, name: str, currency_code: str
) -> Account:
    """Contraparte (ex: "Supermercado") criada na hora se ainda nao existir para o usuario."""
    stmt = select(Account).where(
        Account.user_id == user_id, Account.type == account_type, func.lower(Account.name) == name.lower()
    )
    account = db.execute(stmt).scalar_one_or_none()
    if account:
        return account

    account = Account(user_id=user_id, name=name, type=account_type, currency_code=currency_code)
    try:
        with db.begin_nested():
            db.add(account)
            db.flush()
    except IntegrityError:
        # Outra requisicao criou a mesma contraparte no mesmo instante
        account = db.execute(stmt).scalar_one()
    return account


def get_owned_category(db: Session, user_id: uuid.UUID, category_id: uuid.UUID) -> Category:
    category = db.execute(
        select(Category).where(Category.id == category_id, Category.user_id == user_id)
    ).scalar_one_or_none()
    if not category:
        raise AppError(404, ErrorCode.CATEGORY_NOT_FOUND, "Categoria nao encontrada")
    return category


def get_owned_tags(db: Session, user_id: uuid.UUID, tag_ids: Sequence[uuid.UUID]) -> list[Tag]:
    if not tag_ids:
        return []
    tags = db.execute(select(Tag).where(Tag.id.in_(tag_ids), Tag.user_id == user_id)).scalars().all()
    found = {tag.id for tag in tags}
    missing = set(tag_ids) - found
    if missing:
        raise AppError(404, ErrorCode.TAG_NOT_FOUND, "Tag nao encontrada")
    return list(tags)


def get_owned_transaction(db: Session, user_id: uuid.UUID, transaction_id: uuid.UUID) -> Transaction:
    transaction = db.execute(
        select(Transaction).where(Transaction.id == transaction_id, Transaction.user_id == user_id)
    ).scalar_one_or_none()
    if not transaction:
        raise AppError(404, ErrorCode.TRANSACTION_NOT_FOUND, "Transacao nao encontrada")
    return transaction


def _mismatch(message: str) -> AppError:
    return AppError(400, ErrorCode.CURRENCY_MISMATCH, message)


def _check_currencies(
    data: TransactionSplitCreate, owner: Account, other: Account | None, owner_is_source: bool
) -> None:
    """Garante que o saldo das contas continue certo.

    O `amount` esta sempre na moeda da conta do usuario que paga (ou que recebe, no deposito).
    Se a outra ponta tambem e uma conta do usuario e tem moeda diferente, o valor que chega la
    vem em `foreign_amount` e na moeda dela. Em despesa e receita (contrapartes sem saldo
    proprio) o `foreign_amount` e so informativo: a compra feita em dolar e paga em real.
    """
    if data.currency_code != owner.currency_code:
        raise _mismatch(f"A moeda do lancamento deve ser a da conta ({owner.currency_code})")

    if data.foreign_currency_code is not None and data.foreign_currency_code == data.currency_code:
        raise _mismatch("A moeda estrangeira precisa ser diferente da moeda do lancamento")

    if other is None or other.type not in USER_SIDE_TYPES:
        return

    if other.currency_code != owner.currency_code:
        if not owner_is_source:
            raise _mismatch("Para receber de uma conta de passivo, as duas contas precisam ter a mesma moeda")
        if data.foreign_amount is None or data.foreign_currency_code != other.currency_code:
            raise _mismatch(f"Informe o valor em {other.currency_code}, a moeda da outra conta")
    elif data.foreign_amount is not None:
        raise _mismatch("Contas na mesma moeda nao usam valor em moeda estrangeira")


# ---------- Criacao dos splits ----------


def _resolve_accounts(db: Session, user: User, data: TransactionSplitCreate) -> tuple[uuid.UUID, uuid.UUID]:
    """Devolve (source_account_id, destination_account_id) conforme o tipo e a contraparte."""
    account = get_owned_account(db, user.id, data.account_id)

    if data.type == "transfer":
        other = get_owned_account(db, user.id, data.counterparty_account_id)
        if other.id == account.id:
            raise AppError(400, ErrorCode.INVALID_SPLIT_ACCOUNTS, "Origem e destino nao podem ser a mesma conta")
        _check_currencies(data, owner=account, other=other, owner_is_source=True)
        return account.id, other.id

    other = None
    if data.counterparty_account_id is not None:
        other = get_owned_counterparty(db, user.id, data.counterparty_account_id)
        if other.type not in ALLOWED_COUNTERPARTIES[data.type]:
            raise AppError(
                400,
                ErrorCode.INVALID_SPLIT_ACCOUNTS,
                "Esta conta nao pode ser a outra ponta deste lancamento. Para mover dinheiro entre suas contas, "
                "use uma transferencia",
            )

    is_withdrawal = data.type == "withdrawal"
    _check_currencies(data, owner=account, other=other, owner_is_source=is_withdrawal)

    if other is None:
        other = get_or_create_counterparty(
            db, user.id, COUNTERPARTY_TYPE[data.type], data.counterparty_name, account.currency_code
        )
    return (account.id, other.id) if is_withdrawal else (other.id, account.id)


def _check_budget(db: Session, user: User, data: TransactionSplitCreate, destination_id: uuid.UUID):
    """Orcamento so vale para gasto: saida para uma conta de despesa, na moeda do orcamento.
    Pagar divida e transferir nao sao gasto, e outra moeda nao contaria para o limite."""
    budget = get_owned_budget(db, user.id, data.budget_id)
    destination = db.get(Account, destination_id)
    if data.type != "withdrawal" or destination.type != AccountType.expense:
        raise AppError(400, ErrorCode.BUDGET_NOT_ALLOWED, "Orcamento so vale para saidas para uma despesa")
    if data.currency_code != budget.currency_code:
        raise _mismatch(f"A moeda do lancamento deve ser a do orcamento ({budget.currency_code})")
    return budget


def _resolve_bill(db: Session, user: User, data: TransactionSplitCreate, destination_id: uuid.UUID):
    """Conta a pagar do split. Com `bill_id` no corpo (um id ou null) vale o que veio; sem ele, liga sozinho
    quando exatamente uma conta a pagar combina. So saidas para uma despesa entram."""
    if data.type != "withdrawal":
        if data.bill_id is not None:
            raise AppError(400, ErrorCode.BILL_NOT_ALLOWED, "Conta a pagar so vale para saidas para uma despesa")
        return None
    destination = db.get(Account, destination_id)
    is_expense = destination.type == AccountType.expense
    if "bill_id" in data.model_fields_set:
        if data.bill_id is None:
            return None
        bill = get_owned_bill(db, user.id, data.bill_id)
        if not is_expense:
            raise AppError(400, ErrorCode.BILL_NOT_ALLOWED, "Conta a pagar so vale para saidas para uma despesa")
        if data.currency_code != bill.currency_code:
            raise _mismatch(f"A moeda do lancamento deve ser a da conta a pagar ({bill.currency_code})")
        return bill
    if not is_expense:
        return None
    return find_matching_bill(
        db, user.id, data.currency_code, data.amount, [data.description, destination.name]
    )


def vet_rule_fill(db: Session, user: User, data: TransactionSplitCreate, destination_id: uuid.UUID, fill: Fill) -> dict:
    """Do que as regras querem preencher, devolve so o que serve a este lancamento. Serve tanto
    para o lancamento novo quanto para a aplicacao sobre os antigos. Em `tag_ids` volta a lista
    completa (as que ja tinha mais as novas)."""
    changes: dict = {}
    if fill.category_id is not None:
        owned = db.scalar(select(Category.id).where(Category.id == fill.category_id, Category.user_id == user.id))
        if owned is not None:
            changes["category_id"] = fill.category_id
    if fill.budget_id is not None:
        try:
            _check_budget(db, user, data.model_copy(update={"budget_id": fill.budget_id}), destination_id)
            changes["budget_id"] = fill.budget_id
        except AppError:
            pass
    if fill.bill_id is not None and not ("bill_id" in data.model_fields_set and data.bill_id is None):
        try:
            candidate = data.model_copy(update={"bill_id": fill.bill_id})
            if _resolve_bill(db, user, candidate, destination_id) is not None:
                changes["bill_id"] = fill.bill_id
        except AppError:
            pass
    if fill.add_tag_ids:
        owned_tags = set(
            db.scalars(select(Tag.id).where(Tag.id.in_(fill.add_tag_ids), Tag.user_id == user.id))
        )
        new_tags = [tag_id for tag_id in fill.add_tag_ids if tag_id in owned_tags]
        if new_tags:
            changes["tag_ids"] = [*data.tag_ids, *new_tags]
    return changes


def _apply_rules(
    db: Session,
    user: User,
    data: TransactionSplitCreate,
    source_id: uuid.UUID,
    destination_id: uuid.UUID,
    rules: list[RuleDef],
) -> TransactionSplitCreate:
    """Preenche com as regras so o que o lancamento deixou vazio; o que a pessoa escolheu nunca muda.

    Um alvo que a regra cita e nao serve para este lancamento (categoria ou etiqueta excluida,
    orcamento numa entrada, moeda diferente...) e ignorado em silencio: a regra nunca derruba o
    lancamento. Um `bill_id: null` explicito conta como escolha de nao ligar."""
    if not rules:
        return data
    other = db.get(Account, destination_id if data.account_id == source_id else source_id)
    fill = apply_rules(
        rules,
        SplitFacts(
            type=TransactionType(data.type).value,
            description=data.description,
            amount=data.amount,
            account_id=data.account_id,
            counterparty_name=other.name if other else None,
            category_id=data.category_id,
            budget_id=data.budget_id,
            bill_id=data.bill_id,
            tag_ids=tuple(data.tag_ids),
        ),
    )
    changes = vet_rule_fill(db, user, data, destination_id, fill)
    return data.model_copy(update=changes) if changes else data


def _build_split(
    db: Session,
    user: User,
    transaction_id: uuid.UUID,
    data: TransactionSplitCreate,
    position: int,
    rules: list[RuleDef],
) -> TransactionSplit:
    source_id, destination_id = _resolve_accounts(db, user, data)
    data = _apply_rules(db, user, data, source_id, destination_id, rules)

    currency = get_currency(db, data.currency_code)
    check_amount(currency, data.amount)
    if data.foreign_amount is not None:
        foreign_currency = get_currency(db, data.foreign_currency_code)
        check_amount(foreign_currency, data.foreign_amount)

    category = None
    if data.category_id is not None:
        category = get_owned_category(db, user.id, data.category_id)
    tags = get_owned_tags(db, user.id, data.tag_ids)
    budget = _check_budget(db, user, data, destination_id) if data.budget_id is not None else None
    bill = _resolve_bill(db, user, data, destination_id)

    split = TransactionSplit(
        transaction_id=transaction_id,
        user_id=user.id,
        type=data.type,
        date=data.date,
        description=data.description,
        position=position,
        source_account_id=source_id,
        destination_account_id=destination_id,
        amount=data.amount,
        currency_code=currency.code,
        foreign_amount=data.foreign_amount,
        foreign_currency_code=data.foreign_currency_code,
        category_id=category.id if category else None,
        budget_id=budget.id if budget else None,
        bill_id=bill.id if bill else None,
        notes=data.notes,
    )
    db.add(split)
    db.flush()
    if tags:
        db.execute(
            transaction_split_tags.insert(),
            [{"transaction_split_id": split.id, "tag_id": tag.id} for tag in tags],
        )
    return split


def _enqueue(db: Session, user_id: uuid.UUID, event: WebhookEvent, transaction: Transaction) -> None:
    """Avisa os webhooks que assinaram o evento, na mesma transacao do banco da operacao.
    O corpo e o lancamento no mesmo formato da API (dinheiro como texto)."""
    enqueue_event(
        db,
        user_id,
        event.value,
        lambda: TransactionOut.model_validate(build_output(db, transaction)).model_dump(mode="json"),
    )


def notify_transaction_updated(db: Session, user_id: uuid.UUID, transaction: Transaction) -> None:
    """Para quem altera lancamentos fora da edicao comum (aplicar regras sobre os antigos)."""
    _enqueue(db, user_id, WebhookEvent.transaction_updated, transaction)


def create_transaction(
    db: Session,
    user: User,
    data: TransactionCreate,
    recurrence_id: uuid.UUID | None = None,
    recurrence_date: date | None = None,
) -> Transaction:
    """Ponto unico de criacao: o POST da API e as recorrentes passam por aqui, entao os dois geram o
    evento transaction.created."""
    transaction = Transaction(
        user_id=user.id, title=data.title, recurrence_id=recurrence_id, recurrence_date=recurrence_date
    )
    db.add(transaction)
    db.flush()
    rules = load_rule_defs(db, user.id)
    for position, split_data in enumerate(data.splits):
        _build_split(db, user, transaction.id, split_data, position, rules)
    db.flush()
    _enqueue(db, user.id, WebhookEvent.transaction_created, transaction)
    return transaction


def replace_transaction(db: Session, user: User, transaction: Transaction, data: TransactionCreate) -> Transaction:
    """Edicao: apaga os splits antigos e recria, igual a troca do saldo inicial das contas.

    Tudo na mesma transacao do banco: se um split novo for recusado, a requisicao termina sem
    commit e os splits antigos continuam como estavam.
    """
    # Travado pela conciliacao: nao se edita sem destravar
    assert_unlocked(db, transaction.id)
    transaction.title = data.title
    # O identificador que o banco deu a um lancamento importado nao some na edicao: senao reimportar o mesmo
    # extrato criaria o lancamento de novo. Vale por posicao da linha.
    external = {
        position: (external_id, account_id)
        for position, external_id, account_id in db.execute(
            select(
                TransactionSplit.position, TransactionSplit.external_id, TransactionSplit.external_account_id
            ).where(TransactionSplit.transaction_id == transaction.id, TransactionSplit.external_id.is_not(None))
        )
    }
    # O que ja estava conferido continua conferido (nos lados que ainda fazem parte do lancamento)
    cleared = capture_clearings(db, transaction.id)
    db.execute(delete(TransactionSplit).where(TransactionSplit.transaction_id == transaction.id))
    db.flush()
    rules = load_rule_defs(db, user.id)
    for position, split_data in enumerate(data.splits):
        created = _build_split(db, user, transaction.id, split_data, position, rules)
        if position in external:
            created.external_id, created.external_account_id = external[position]
        restore_clearings(db, user.id, created, cleared.get(position, []))
    db.flush()
    _enqueue(db, user.id, WebhookEvent.transaction_updated, transaction)
    return transaction


def delete_transaction(db: Session, transaction: Transaction) -> list[Path]:
    """Apaga o lancamento (os anexos saem do banco em cascata) e devolve os arquivos deles, para
    quem chama apagar do disco depois de gravar."""
    # Travado pela conciliacao: nao se exclui sem destravar
    assert_unlocked(db, transaction.id)
    # O evento leva o retrato do lancamento de antes de excluir, por isso vem primeiro
    _enqueue(db, transaction.user_id, WebhookEvent.transaction_deleted, transaction)
    attachments = db.execute(select(Attachment).where(Attachment.transaction_id == transaction.id)).scalars().all()
    paths = [storage_path(attachment.user_id, attachment.storage_name) for attachment in attachments]
    db.delete(transaction)
    db.flush()
    return paths


# ---------- Leitura ----------


def tag_ids_by_split(db: Session, split_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    if not split_ids:
        return {}
    rows = db.execute(
        select(transaction_split_tags.c.transaction_split_id, transaction_split_tags.c.tag_id).where(
            transaction_split_tags.c.transaction_split_id.in_(split_ids)
        )
    ).all()
    result: dict[uuid.UUID, list[uuid.UUID]] = {split_id: [] for split_id in split_ids}
    for split_id, tag_id in rows:
        result[split_id].append(tag_id)
    return result


def build_outputs(db: Session, transactions: Sequence[Transaction]) -> list[dict]:
    """Monta a resposta de varios grupos com um numero fixo de consultas (splits, tags e moedas),
    seja a pagina de 1 ou de 200 transacoes."""
    if not transactions:
        return []

    ids = [transaction.id for transaction in transactions]
    splits = (
        db.execute(
            select(TransactionSplit)
            .where(TransactionSplit.transaction_id.in_(ids))
            .order_by(TransactionSplit.position, TransactionSplit.id)
        )
        .scalars()
        .all()
    )
    splits_by_transaction: dict[uuid.UUID, list[TransactionSplit]] = defaultdict(list)
    for split in splits:
        splits_by_transaction[split.transaction_id].append(split)

    # Uma consulta agrupada para todos os lancamentos da pagina
    attachment_counts = dict(
        db.execute(
            select(Attachment.transaction_id, func.count())
            .where(Attachment.transaction_id.in_(ids))
            .group_by(Attachment.transaction_id)
        ).all()
    )

    tag_map = tag_ids_by_split(db, [split.id for split in splits])
    clearing_map = clearing_states(db, [split.id for split in splits])
    account_ids = {split.source_account_id for split in splits} | {split.destination_account_id for split in splits}
    accounts = {
        row.id: row
        for row in db.execute(select(Account.id, Account.name, Account.type).where(Account.id.in_(account_ids)))
    }
    codes = {split.currency_code for split in splits} | {
        split.foreign_currency_code for split in splits if split.foreign_currency_code
    }
    places = dict(db.execute(select(Currency.code, Currency.decimal_places).where(Currency.code.in_(codes))).all())

    def money(value: Decimal | None, currency_code: str | None) -> Decimal | None:
        # Mesmas casas da moeda em todas as respostas (JPY sem centavos, BRL com 2)
        return None if value is None else quantize_money(value, places[currency_code])

    return [
        {
            "id": transaction.id,
            "title": transaction.title,
            "recurrence_id": transaction.recurrence_id,
            "installment_index": transaction.installment_index,
            "installment_count": transaction.installment_count,
            "created_at": transaction.created_at,
            "attachment_count": attachment_counts.get(transaction.id, 0),
            "splits": [
                {
                    "id": split.id,
                    "type": split.type,
                    "date": split.date,
                    "description": split.description,
                    "source_account_id": split.source_account_id,
                    "destination_account_id": split.destination_account_id,
                    "source_account_name": accounts[split.source_account_id].name,
                    "source_account_type": accounts[split.source_account_id].type,
                    "destination_account_name": accounts[split.destination_account_id].name,
                    "destination_account_type": accounts[split.destination_account_id].type,
                    "amount": money(split.amount, split.currency_code),
                    "currency_code": split.currency_code,
                    "foreign_amount": money(split.foreign_amount, split.foreign_currency_code),
                    "foreign_currency_code": split.foreign_currency_code,
                    "category_id": split.category_id,
                    "budget_id": split.budget_id,
                    "bill_id": split.bill_id,
                    "tag_ids": tag_map.get(split.id, []),
                    "notes": split.notes,
                    "cleared": clearing_map.get(split.id, (False, False))[0],
                    "locked": clearing_map.get(split.id, (False, False))[1],
                }
                for split in splits_by_transaction[transaction.id]
            ],
        }
        for transaction in transactions
    ]


def build_output(db: Session, transaction: Transaction) -> dict:
    return build_outputs(db, [transaction])[0]


@dataclass(frozen=True)
class TransactionFilters:
    """Filtros da lista de transacoes. A mesma forma serve a lista e a exportacao em CSV."""

    account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    budget_id: uuid.UUID | None = None
    bill_id: uuid.UUID | None = None
    tag_id: uuid.UUID | None = None
    date_from: date | None = None
    date_to: date | None = None
    q: str | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None


def _matched_groups(user_id: uuid.UUID, filters: TransactionFilters):
    """Subconsulta com os grupos do usuario (e a data mais recente de cada um) que atendem aos filtros.

    Um grupo entra se algum split dele atende a TODOS os filtros ao mesmo tempo.
    Os valores minimo e maximo comparam o `amount` do split, na moeda dele.
    """
    conditions = [TransactionSplit.user_id == user_id, TransactionSplit.type.in_(LISTED_TYPES)]
    if filters.account_id is not None:
        conditions.append(
            or_(
                TransactionSplit.source_account_id == filters.account_id,
                TransactionSplit.destination_account_id == filters.account_id,
            )
        )
    if filters.category_id is not None:
        conditions.append(TransactionSplit.category_id == filters.category_id)
    if filters.budget_id is not None:
        conditions.append(TransactionSplit.budget_id == filters.budget_id)
    if filters.bill_id is not None:
        conditions.append(TransactionSplit.bill_id == filters.bill_id)
    if filters.date_from is not None:
        conditions.append(TransactionSplit.date >= filters.date_from)
    if filters.date_to is not None:
        conditions.append(TransactionSplit.date <= filters.date_to)
    if filters.min_amount is not None:
        conditions.append(TransactionSplit.amount >= filters.min_amount)
    if filters.max_amount is not None:
        conditions.append(TransactionSplit.amount <= filters.max_amount)
    if filters.q and filters.q.strip():
        # autoescape: um "%" ou "_" digitado na busca e texto comum, nao curinga
        term = filters.q.strip().lower()
        conditions.append(
            or_(
                func.lower(TransactionSplit.description).contains(term, autoescape=True),
                func.lower(func.coalesce(Transaction.title, "")).contains(term, autoescape=True),
            )
        )

    matching = select(
        TransactionSplit.transaction_id.label("transaction_id"),
        func.max(TransactionSplit.date).label("last_date"),
    ).join(Transaction, Transaction.id == TransactionSplit.transaction_id)
    if filters.tag_id is not None:
        matching = matching.join(
            transaction_split_tags, transaction_split_tags.c.transaction_split_id == TransactionSplit.id
        ).where(transaction_split_tags.c.tag_id == filters.tag_id)
    return matching.where(*conditions).group_by(TransactionSplit.transaction_id).subquery()


def _ordered_transactions(matched):
    return (
        select(Transaction)
        .join(matched, matched.c.transaction_id == Transaction.id)
        # Desempate por created_at e id: sem ele, grupos do mesmo dia trocam de pagina
        .order_by(matched.c.last_date.desc(), Transaction.created_at.desc(), Transaction.id)
    )


def list_transactions(
    db: Session,
    user_id: uuid.UUID,
    params: PageParams,
    *,
    account_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    budget_id: uuid.UUID | None = None,
    bill_id: uuid.UUID | None = None,
    tag_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    min_amount: Decimal | None = None,
    max_amount: Decimal | None = None,
) -> dict:
    """Lista os grupos do usuario, do mais recente para o mais antigo (pela data do lancamento)."""
    filters = TransactionFilters(
        account_id=account_id,
        category_id=category_id,
        budget_id=budget_id,
        bill_id=bill_id,
        tag_id=tag_id,
        date_from=date_from,
        date_to=date_to,
        q=q,
        min_amount=min_amount,
        max_amount=max_amount,
    )
    matched = _matched_groups(user_id, filters)
    total = db.scalar(select(func.count()).select_from(matched))
    page = db.execute(_ordered_transactions(matched).limit(params.limit).offset(params.offset)).scalars().all()
    return {
        "items": build_outputs(db, page),
        "total": total,
        "limit": params.limit,
        "offset": params.offset,
    }


def iter_transaction_blocks(
    db: Session, user_id: uuid.UUID, filters: TransactionFilters, block_size: int
) -> Iterator[list[dict]]:
    """Os mesmos grupos e a mesma ordem de `list_transactions`, em blocos de `block_size` grupos.
    Cada bloco e uma consulta de paginas, entao a memoria nunca guarda a lista inteira."""
    statement = _ordered_transactions(_matched_groups(user_id, filters))
    offset = 0
    while True:
        page = db.execute(statement.limit(block_size).offset(offset)).scalars().all()
        if not page:
            return
        yield build_outputs(db, page)
        if len(page) < block_size:
            return
        offset += block_size


def list_counterparties(db: Session, user_id: uuid.UUID, account_type: str, q: str | None, limit: int) -> list[Account]:
    """Nomes de despesa ou receita que o usuario ja usou, em ordem alfabetica, para sugerir ao digitar."""
    statement = select(Account).where(Account.user_id == user_id, Account.type == AccountType(account_type))
    if q and q.strip():
        statement = statement.where(func.lower(Account.name).contains(q.strip().lower(), autoescape=True))
    return list(db.execute(statement.order_by(func.lower(Account.name), Account.id).limit(limit)).scalars())

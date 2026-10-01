import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models.account import USER_ACCOUNT_TYPES, Account, AccountRole, AccountType
from app.models.currency import Currency
from app.models.transaction import Transaction, TransactionSplit, TransactionType
from app.models.user import User
from app.schemas.account import AccountCreate, AccountOut, AccountUpdate, roles_for
from app.services.ledger import balances_by_account

SYSTEM_ACCOUNT_LABELS = {
    AccountType.initial_balance: "Saldo inicial",
    AccountType.reconciliation: "Conciliacao",
}
DEFAULT_ROLES = {AccountType.asset: AccountRole.checking, AccountType.liability: AccountRole.debt}


# ---------- Validacoes ----------


def get_currency(db: Session, code: str) -> Currency:
    currency = db.get(Currency, code)
    if not currency:
        raise AppError(400, ErrorCode.CURRENCY_NOT_FOUND, "Moeda nao encontrada")
    return currency


def check_amount(currency: Currency, amount: Decimal) -> None:
    """JPY nao tem centavos e BRL tem 2 casas: recusa valor com casas a mais para a moeda."""
    step = Decimal(10) ** -currency.decimal_places
    if amount != amount.quantize(step):
        raise AppError(
            400,
            ErrorCode.INVALID_AMOUNT,
            f"A moeda {currency.code} aceita no maximo {currency.decimal_places} casas decimais",
        )


def check_name_free(db: Session, user_id: uuid.UUID, account_type: AccountType, name: str, ignore_id=None) -> None:
    # Sem diferenciar maiuscula de minuscula: "Nubank" e "nubank" seriam a mesma conta para o usuario
    stmt = select(Account.id).where(
        Account.user_id == user_id,
        Account.type == account_type,
        func.lower(Account.name) == name.lower(),
    )
    if ignore_id is not None:
        stmt = stmt.where(Account.id != ignore_id)
    if db.execute(stmt).first():
        raise AppError(409, ErrorCode.ACCOUNT_NAME_TAKEN, "Ja existe uma conta com esse nome")


def get_owned_account(db: Session, user_id: uuid.UUID, account_id: uuid.UUID) -> Account:
    """404 tambem quando a conta e de outro usuario, para nao revelar que ela existe."""
    account = db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.user_id == user_id,
            Account.type.in_(USER_ACCOUNT_TYPES),
        )
    ).scalar_one_or_none()
    if not account:
        raise AppError(404, ErrorCode.ACCOUNT_NOT_FOUND, "Conta nao encontrada")
    return account


# ---------- Saldo inicial (uma transacao especial, estilo Firefly) ----------


def _system_account(db: Session, user_id: uuid.UUID, account_type: AccountType, currency_code: str) -> Account:
    """Conta de sistema (ex: "Saldo inicial (BRL)"), uma por usuario e moeda, criada na primeira vez."""
    name = f"{SYSTEM_ACCOUNT_LABELS[account_type]} ({currency_code})"
    stmt = select(Account).where(Account.user_id == user_id, Account.type == account_type, Account.name == name)
    account = db.execute(stmt).scalar_one_or_none()
    if account:
        return account

    account = Account(user_id=user_id, name=name, type=account_type, currency_code=currency_code)
    try:
        with db.begin_nested():
            db.add(account)
            db.flush()
    except IntegrityError:
        # Outra requisicao criou a mesma conta de sistema no mesmo instante
        account = db.execute(stmt).scalar_one()
    return account


def _opening_splits_query(account_ids):
    return select(TransactionSplit).where(
        TransactionSplit.type == TransactionType.opening_balance,
        or_(
            TransactionSplit.source_account_id.in_(account_ids),
            TransactionSplit.destination_account_id.in_(account_ids),
        ),
    )


def _remove_opening(db: Session, account: Account) -> None:
    splits = db.execute(_opening_splits_query([account.id])).scalars().all()
    if splits:
        # Apagar o grupo apaga os splits dele (cascata no banco)
        db.execute(delete(Transaction).where(Transaction.id.in_({s.transaction_id for s in splits})))
        db.expire_all()


def set_opening_balance(db: Session, account: Account, signed_balance: Decimal, on_date: date) -> None:
    """Troca a transacao de saldo inicial da conta. `signed_balance`: positivo entra, negativo sai."""
    _remove_opening(db, account)
    if signed_balance == 0:
        return

    system = _system_account(db, account.user_id, AccountType.initial_balance, account.currency_code)
    if signed_balance > 0:
        source_id, destination_id, amount = system.id, account.id, signed_balance
    else:
        source_id, destination_id, amount = account.id, system.id, -signed_balance

    transaction = Transaction(user_id=account.user_id, title=f"Saldo inicial de {account.name}")
    db.add(transaction)
    db.flush()
    db.add(
        TransactionSplit(
            transaction_id=transaction.id,
            user_id=account.user_id,
            type=TransactionType.opening_balance,
            date=on_date,
            description=f"Saldo inicial de {account.name}",
            source_account_id=source_id,
            destination_account_id=destination_id,
            amount=amount,
            currency_code=account.currency_code,
        )
    )
    db.flush()


def _to_signed(account_type: AccountType, value: Decimal) -> Decimal:
    """Passivo: o usuario informa quanto deve; no livro-caixa isso e um saldo negativo."""
    return value if account_type == AccountType.asset else -value


def _openings(db: Session, accounts: list[Account]) -> dict[uuid.UUID, tuple[Decimal, date]]:
    """Saldo inicial no sentido da tela (valor devido para passivo) e a data, por conta."""
    if not accounts:
        return {}
    by_id = {a.id: a for a in accounts}
    result: dict[uuid.UUID, tuple[Decimal, date]] = {}
    for split in db.execute(_opening_splits_query(list(by_id))).scalars():
        if split.destination_account_id in by_id:
            account, signed = by_id[split.destination_account_id], split.amount
        else:
            account, signed = by_id[split.source_account_id], -split.amount
        result[account.id] = (_to_signed(account.type, signed), split.date)
    return result


# ---------- Operacoes ----------


def quantize_money(value: Decimal, decimal_places: int) -> Decimal:
    """Garante as casas da moeda ("0" vira "0.00" em BRL e fica "0" em JPY)."""
    return value.quantize(Decimal(10) ** -decimal_places)


def build_outputs(db: Session, accounts: list[Account]) -> list[AccountOut]:
    balances = balances_by_account(db, [a.id for a in accounts])
    openings = _openings(db, accounts)
    places = dict(
        db.execute(
            select(Currency.code, Currency.decimal_places).where(
                Currency.code.in_({a.currency_code for a in accounts})
            )
        ).all()
    )
    outputs = []
    for account in accounts:
        decimals = places[account.currency_code]
        opening, opening_date = openings.get(account.id, (Decimal(0), None))
        outputs.append(
            AccountOut(
                id=account.id,
                name=account.name,
                type=account.type,
                role=account.role,
                currency_code=account.currency_code,
                active=account.active,
                iban=account.iban,
                account_number=account.account_number,
                notes=account.notes,
                opening_balance=quantize_money(opening, decimals),
                opening_balance_date=opening_date,
                balance=quantize_money(balances[account.id], decimals),
                created_at=account.created_at,
            )
        )
    return outputs


def create_account(db: Session, user: User, data: AccountCreate) -> Account:
    currency = get_currency(db, data.currency_code)
    check_amount(currency, data.opening_balance)
    check_name_free(db, user.id, data.type, data.name)

    account = Account(
        user_id=user.id,
        name=data.name,
        type=data.type,
        role=data.role or DEFAULT_ROLES[data.type],
        currency_code=currency.code,
        iban=data.iban,
        account_number=data.account_number,
        notes=data.notes,
    )
    try:
        with db.begin_nested():
            db.add(account)
            db.flush()
    except IntegrityError:
        raise AppError(409, ErrorCode.ACCOUNT_NAME_TAKEN, "Ja existe uma conta com esse nome")

    set_opening_balance(
        db, account, _to_signed(data.type, data.opening_balance), data.opening_balance_date or date.today()
    )
    return account


def update_account(db: Session, account: Account, data: AccountUpdate) -> Account:
    provided = data.model_fields_set

    if "name" in provided and data.name is not None:
        check_name_free(db, account.user_id, account.type, data.name, ignore_id=account.id)
        account.name = data.name
    if "role" in provided and data.role is not None:
        if data.role not in roles_for(account.type):
            raise AppError(400, ErrorCode.VALIDATION_ERROR, "Papel incompativel com o tipo da conta")
        account.role = data.role
    if "active" in provided and data.active is not None:
        account.active = data.active
    for field in ("iban", "account_number", "notes"):
        if field in provided:
            setattr(account, field, getattr(data, field))

    if ("opening_balance" in provided and data.opening_balance is not None) or "opening_balance_date" in provided:
        current = _openings(db, [account]).get(account.id)
        value = data.opening_balance if data.opening_balance is not None else (current[0] if current else Decimal(0))
        on_date = data.opening_balance_date or (current[1] if current else date.today())
        if account.type == AccountType.liability and value < 0:
            raise AppError(400, ErrorCode.INVALID_AMOUNT, "O valor devido nao pode ser negativo")
        check_amount(get_currency(db, account.currency_code), value)
        set_opening_balance(db, account, _to_signed(account.type, value), on_date)

    db.flush()
    return account


def delete_account(db: Session, account: Account) -> None:
    """So apaga conta sem movimento. Com historico, o caminho e arquivar (active=False)."""
    other_movement = db.execute(
        select(func.count())
        .select_from(TransactionSplit)
        .where(
            or_(
                TransactionSplit.source_account_id == account.id,
                TransactionSplit.destination_account_id == account.id,
            ),
            TransactionSplit.type != TransactionType.opening_balance,
        )
    ).scalar_one()
    if other_movement:
        raise AppError(
            409,
            ErrorCode.ACCOUNT_HAS_TRANSACTIONS,
            "A conta tem transacoes e nao pode ser excluida. Arquive-a em vez disso",
        )
    _remove_opening(db, account)
    db.delete(account)
    db.flush()

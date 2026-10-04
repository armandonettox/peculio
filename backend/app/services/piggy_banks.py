import uuid
from collections.abc import Sequence
from datetime import date
from decimal import ROUND_CEILING, Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import clock
from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate
from app.models.account import Account, AccountType
from app.models.currency import Currency
from app.models.piggy_bank import PiggyBank, PiggyBankEvent
from app.models.user import User
from app.schemas.piggy_bank import PiggyBankCreate, PiggyBankEventCreate, PiggyBankUpdate
from app.services.accounts import check_amount, get_owned_account, quantize_money
from app.services.ledger import balances_by_account

ZERO = Decimal(0)


# ---------- Acesso e CRUD ----------


def get_owned_piggy_bank(db: Session, user_id: uuid.UUID, piggy_bank_id: uuid.UUID) -> PiggyBank:
    """404 tambem quando e de outro usuario, para nao revelar que existe."""
    piggy = db.execute(
        select(PiggyBank).where(PiggyBank.id == piggy_bank_id, PiggyBank.user_id == user_id)
    ).scalar_one_or_none()
    if not piggy:
        raise AppError(404, ErrorCode.PIGGY_BANK_NOT_FOUND, "Cofrinho nao encontrado")
    return piggy


def _save(db: Session, piggy: PiggyBank) -> None:
    # A unicidade e do banco (indice em lower(nome)): vale mesmo com duas requisicoes juntas
    try:
        with db.begin_nested():
            db.add(piggy)
            db.flush()
    except IntegrityError:
        raise AppError(409, ErrorCode.PIGGY_BANK_NAME_TAKEN, "Ja existe um cofrinho com esse nome")


def _places(db: Session, currency_code: str) -> int:
    return db.execute(select(Currency.decimal_places).where(Currency.code == currency_code)).scalar_one()


def create_piggy_bank(db: Session, user: User, data: PiggyBankCreate) -> PiggyBank:
    account = get_owned_account(db, user.id, data.account_id)
    if account.type != AccountType.asset:
        raise AppError(
            400, ErrorCode.PIGGY_BANK_ACCOUNT_INVALID, "Um cofrinho fica numa conta, nao numa divida"
        )
    check_amount(db.get(Currency, account.currency_code), data.target_amount)
    piggy = PiggyBank(
        user_id=user.id,
        account_id=account.id,
        name=data.name,
        target_amount=data.target_amount,
        target_date=data.target_date,
    )
    _save(db, piggy)
    return piggy


def update_piggy_bank(db: Session, piggy: PiggyBank, data: PiggyBankUpdate) -> PiggyBank:
    sent = data.model_fields_set
    if data.name is not None:
        piggy.name = data.name
    if data.target_amount is not None:
        account = db.get(Account, piggy.account_id)
        check_amount(db.get(Currency, account.currency_code), data.target_amount)
        piggy.target_amount = data.target_amount
    if "target_date" in sent:
        piggy.target_date = data.target_date
    if data.active is not None:
        piggy.active = data.active
    _save(db, piggy)
    return piggy


def delete_piggy_bank(db: Session, piggy: PiggyBank) -> None:
    # Os movimentos vao junto (ON DELETE CASCADE) e o dinheiro reservado volta a ficar disponivel na conta
    db.delete(piggy)
    db.flush()


# ---------- Valores calculados ----------


def saved_by_piggy(db: Session, piggy_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    if not piggy_ids:
        return {}
    rows = db.execute(
        select(PiggyBankEvent.piggy_bank_id, func.sum(PiggyBankEvent.amount))
        .where(PiggyBankEvent.piggy_bank_id.in_(piggy_ids))
        .group_by(PiggyBankEvent.piggy_bank_id)
    ).all()
    return {piggy_id: total for piggy_id, total in rows}


def reserved_by_account(
    db: Session, account_ids: Sequence[uuid.UUID], as_of: date | None = None
) -> dict[uuid.UUID, Decimal]:
    """Tudo o que esta guardado em cofrinhos de cada conta (ate `as_of`, se informado)."""
    if not account_ids:
        return {}
    statement = (
        select(PiggyBank.account_id, func.sum(PiggyBankEvent.amount))
        .join(PiggyBankEvent, PiggyBankEvent.piggy_bank_id == PiggyBank.id)
        .where(PiggyBank.account_id.in_(account_ids))
        .group_by(PiggyBank.account_id)
    )
    if as_of is not None:
        statement = statement.where(PiggyBankEvent.date <= as_of)
    rows = db.execute(statement).all()
    return {account_id: total for account_id, total in rows}


def months_left(target: date, today: date) -> int:
    """Meses de calendario ate a data alvo, no minimo 1 (o proprio mes conta como um mes)."""
    return max(1, (target.year - today.year) * 12 + target.month - today.month)


def suggested_per_month(remaining: Decimal, target_date: date | None, today: date, places: int) -> Decimal | None:
    if target_date is None or target_date < today or remaining <= 0:
        return None
    step = Decimal(10) ** -places
    return (remaining / months_left(target_date, today)).quantize(step, rounding=ROUND_CEILING)


def build_outputs(db: Session, piggies: Sequence[PiggyBank], today: date) -> list[dict]:
    """Varios cofrinhos com um numero fixo de consultas: contas, moedas, guardado, reservado e saldos."""
    if not piggies:
        return []
    account_ids = list({piggy.account_id for piggy in piggies})
    accounts = {a.id: a for a in db.execute(select(Account).where(Account.id.in_(account_ids))).scalars()}
    places = dict(
        db.execute(
            select(Currency.code, Currency.decimal_places).where(
                Currency.code.in_({a.currency_code for a in accounts.values()})
            )
        ).all()
    )
    saved = saved_by_piggy(db, [piggy.id for piggy in piggies])
    reserved = reserved_by_account(db, account_ids)
    balances = balances_by_account(db, account_ids)

    items = []
    for piggy in piggies:
        account = accounts[piggy.account_id]
        decimals = places[account.currency_code]
        total = saved.get(piggy.id, ZERO)
        remaining = max(piggy.target_amount - total, ZERO)
        available = balances.get(account.id, ZERO) - reserved.get(account.id, ZERO)
        suggestion = suggested_per_month(remaining, piggy.target_date, today, decimals)
        items.append(
            {
                "id": piggy.id,
                "name": piggy.name,
                "account_id": account.id,
                "account_name": account.name,
                "currency_code": account.currency_code,
                "target_amount": quantize_money(piggy.target_amount, decimals),
                "target_date": piggy.target_date,
                "active": piggy.active,
                "saved": quantize_money(total, decimals),
                "remaining": quantize_money(remaining, decimals),
                # Divisao inteira de Decimals: nunca arredonda para cima
                "percent": int((total * 100) // piggy.target_amount),
                "suggested_per_month": None if suggestion is None else quantize_money(suggestion, decimals),
                "account_available": quantize_money(available, decimals),
                "created_at": piggy.created_at,
            }
        )
    return items


def list_piggy_banks(db: Session, user_id: uuid.UUID, params: PageParams, q: str | None, active: bool | None) -> dict:
    statement = select(PiggyBank).where(PiggyBank.user_id == user_id)
    if active is not None:
        statement = statement.where(PiggyBank.active == active)
    if q and q.strip():
        # autoescape: um "%" ou "_" digitado na busca e texto comum, nao curinga
        statement = statement.where(func.lower(PiggyBank.name).contains(q.strip().lower(), autoescape=True))
    page = paginate(db, statement.order_by(func.lower(PiggyBank.name), PiggyBank.id), params)
    page["items"] = build_outputs(db, page["items"], clock.today())
    return page


# ---------- Guardar e retirar ----------


def add_event(db: Session, piggy: PiggyBank, data: PiggyBankEventCreate) -> PiggyBankEvent:
    today = clock.today()
    day = data.date or today
    if day > today:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "A data nao pode ser no futuro")

    # Trava a conta: duas requisicoes juntas nao podem reservar o mesmo dinheiro duas vezes
    account = db.execute(select(Account).where(Account.id == piggy.account_id).with_for_update()).scalar_one()
    check_amount(db.get(Currency, account.currency_code), data.amount)

    if data.kind == "add":
        if not piggy.active:
            raise AppError(409, ErrorCode.PIGGY_BANK_ARCHIVED, "O cofrinho esta arquivado: desarquive para guardar mais")
        balance = balances_by_account(db, [account.id]).get(account.id, ZERO)
        available = balance - reserved_by_account(db, [account.id]).get(account.id, ZERO)
        if data.amount > available:
            raise AppError(
                400,
                ErrorCode.PIGGY_BANK_NOT_ENOUGH_AVAILABLE,
                "A conta nao tem esse valor disponivel (o que ja esta guardado em cofrinhos nao conta)",
            )
        signed = data.amount
    else:
        if data.amount > saved_by_piggy(db, [piggy.id]).get(piggy.id, ZERO):
            raise AppError(400, ErrorCode.PIGGY_BANK_NOT_ENOUGH_SAVED, "O cofrinho nao tem esse valor guardado")
        signed = -data.amount

    event = PiggyBankEvent(piggy_bank_id=piggy.id, user_id=piggy.user_id, amount=signed, date=day, note=data.note)
    db.add(event)
    db.flush()
    return event


def event_output(event: PiggyBankEvent, decimals: int) -> dict:
    return {
        "id": event.id,
        "kind": "add" if event.amount > 0 else "remove",
        "amount": quantize_money(abs(event.amount), decimals),
        "date": event.date,
        "note": event.note,
        "created_at": event.created_at,
    }


def list_events(db: Session, piggy: PiggyBank, params: PageParams) -> dict:
    decimals = _places(db, db.get(Account, piggy.account_id).currency_code)
    statement = (
        select(PiggyBankEvent)
        .where(PiggyBankEvent.piggy_bank_id == piggy.id)
        .order_by(PiggyBankEvent.date.desc(), PiggyBankEvent.created_at.desc(), PiggyBankEvent.id)
    )
    page = paginate(db, statement, params)
    page["items"] = [event_output(event, decimals) for event in page["items"]]
    return page

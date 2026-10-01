import calendar
import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate
from app.models.bill import Bill, BillFrequency
from app.models.currency import Currency
from app.models.transaction import TransactionSplit, TransactionType
from app.models.user import User
from app.schemas.bill import BillCreate, BillUpdate
from app.services.accounts import check_amount, get_currency, quantize_money

# ---------- Datas dos vencimentos (funcoes puras) ----------

MONTH_STEP = {
    BillFrequency.monthly: 1,
    BillFrequency.quarterly: 3,
    BillFrequency.half_yearly: 6,
    BillFrequency.yearly: 12,
}


def occurrence(first: date, frequency: BillFrequency, index: int) -> date:
    """O vencimento de numero `index` (0 = o primeiro). Conta sempre a partir do primeiro, entao
    uma conta do dia 31 vence no ultimo dia dos meses curtos e volta ao 31 quando o mes tem."""
    if frequency == BillFrequency.weekly:
        return first + timedelta(days=7 * index)
    total = first.month - 1 + MONTH_STEP[frequency] * index
    year, month = first.year + total // 12, total % 12 + 1
    return date(year, month, min(first.day, calendar.monthrange(year, month)[1]))


def latest_index(first: date, frequency: BillFrequency, on: date) -> int | None:
    """Numero do ultimo vencimento que ja chegou (<= on), ou None se o primeiro ainda esta no futuro."""
    if on < first:
        return None
    if frequency == BillFrequency.weekly:
        return (on - first).days // 7
    months = (on.year - first.year) * 12 + (on.month - first.month)
    index = months // MONTH_STEP[frequency]
    # O mes do vencimento pode ser o de `on` e o dia ainda nao ter chegado
    while occurrence(first, frequency, index) > on:
        index -= 1
    return index


def _midpoint(start: date, end: date) -> date:
    return start + timedelta(days=(end - start).days // 2)


def window(first: date, frequency: BillFrequency, index: int) -> tuple[date | None, date]:
    """Datas de pagamento que quitam o vencimento `index`: do ponto medio com o vencimento anterior
    (exclusivo) ate o ponto medio com o seguinte (inclusivo). Cada pagamento cai em um so vencimento,
    o mais proximo dele, e pagar um pouco antes ou depois continua valendo."""
    due = occurrence(first, frequency, index)
    low = None if index == 0 else _midpoint(occurrence(first, frequency, index - 1), due)
    high = _midpoint(due, occurrence(first, frequency, index + 1))
    return low, high


def _paid(payments: Sequence[date], low: date | None, high: date) -> bool:
    return any((low is None or day > low) and day <= high for day in payments)


# ---------- Acesso e CRUD ----------


def get_owned_bill(db: Session, user_id: uuid.UUID, bill_id: uuid.UUID) -> Bill:
    """404 tambem quando a conta e de outro usuario, para nao revelar que ela existe."""
    bill = db.execute(select(Bill).where(Bill.id == bill_id, Bill.user_id == user_id)).scalar_one_or_none()
    if not bill:
        raise AppError(404, ErrorCode.BILL_NOT_FOUND, "Conta a pagar nao encontrada")
    return bill


def _save(db: Session, bill: Bill) -> None:
    # A unicidade e do banco (indice em lower(nome)): vale mesmo com duas requisicoes juntas
    try:
        with db.begin_nested():
            db.add(bill)
            db.flush()
    except IntegrityError:
        raise AppError(409, ErrorCode.BILL_NAME_TAKEN, "Ja existe uma conta a pagar com esse nome")


def _check_range(currency: Currency, amount_min: Decimal, amount_max: Decimal) -> None:
    check_amount(currency, amount_min)
    check_amount(currency, amount_max)
    if amount_max < amount_min:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "O valor maximo nao pode ser menor que o minimo")


def create_bill(db: Session, user: User, data: BillCreate) -> Bill:
    currency = get_currency(db, data.currency_code)
    _check_range(currency, data.amount_min, data.amount_max)
    bill = Bill(
        user_id=user.id,
        name=data.name,
        currency_code=currency.code,
        amount_min=data.amount_min,
        amount_max=data.amount_max,
        match_text=data.match_text,
        first_due_date=data.first_due_date,
        frequency=data.frequency,
    )
    _save(db, bill)
    return bill


def update_bill(db: Session, bill: Bill, data: BillUpdate) -> Bill:
    changes = data.model_dump(exclude_unset=True)
    # Nome, valores, data, frequencia e situacao nao aceitam vazio; so match_text pode ser apagado
    changes = {k: v for k, v in changes.items() if v is not None or k == "match_text"}
    new_min = changes.get("amount_min", bill.amount_min)
    new_max = changes.get("amount_max", bill.amount_max)
    if "amount_min" in changes or "amount_max" in changes:
        _check_range(get_currency(db, bill.currency_code), new_min, new_max)
    for field, value in changes.items():
        setattr(bill, field, value)
    _save(db, bill)
    return bill


def delete_bill(db: Session, bill: Bill) -> None:
    # Os lancamentos ligados ficam sem conta a pagar (ON DELETE SET NULL no banco)
    db.delete(bill)
    db.flush()


def _places(db: Session, codes: set[str]) -> dict[str, int]:
    if not codes:
        return {}
    return dict(db.execute(select(Currency.code, Currency.decimal_places).where(Currency.code.in_(codes))).all())


def bill_output(bill: Bill, places: int) -> dict:
    return {
        "id": bill.id,
        "name": bill.name,
        "currency_code": bill.currency_code,
        "amount_min": quantize_money(bill.amount_min, places),
        "amount_max": quantize_money(bill.amount_max, places),
        "match_text": bill.match_text,
        "first_due_date": bill.first_due_date,
        "frequency": bill.frequency,
        "active": bill.active,
        "created_at": bill.created_at,
    }


def build_outputs(db: Session, bills: Sequence[Bill]) -> list[dict]:
    places = _places(db, {bill.currency_code for bill in bills})
    return [bill_output(bill, places[bill.currency_code]) for bill in bills]


def list_bills(db: Session, user_id: uuid.UUID, params: PageParams, q: str | None, active: bool | None) -> dict:
    statement = select(Bill).where(Bill.user_id == user_id)
    if active is not None:
        statement = statement.where(Bill.active == active)
    if q and q.strip():
        # autoescape: um "%" ou "_" digitado na busca e texto comum, nao curinga
        statement = statement.where(func.lower(Bill.name).contains(q.strip().lower(), autoescape=True))
    page = paginate(db, statement.order_by(func.lower(Bill.name), Bill.id), params)
    page["items"] = build_outputs(db, page["items"])
    return page


# ---------- Situacao dos vencimentos ----------


def status(db: Session, user_id: uuid.UUID, on: date, include_archived: bool) -> list[dict]:
    """Cada conta a pagar com o ultimo e o proximo vencimento e se o ultimo foi pago, ordenadas pelo
    proximo vencimento. Uma consulta busca os pagamentos de todas as contas."""
    statement = select(Bill).where(Bill.user_id == user_id)
    if not include_archived:
        statement = statement.where(Bill.active.is_(True))
    bills = list(db.execute(statement).scalars())
    if not bills:
        return []

    indexes = {bill.id: latest_index(bill.first_due_date, bill.frequency, on) for bill in bills}
    payments: dict[uuid.UUID, list[date]] = defaultdict(list)
    rows = db.execute(
        select(TransactionSplit.bill_id, TransactionSplit.date).where(
            TransactionSplit.user_id == user_id,
            TransactionSplit.bill_id.in_([bill.id for bill in bills]),
            TransactionSplit.type == TransactionType.withdrawal,
        )
    ).all()
    for bill_id, day in rows:
        payments[bill_id].append(day)

    places = _places(db, {bill.currency_code for bill in bills})
    items = []
    for bill in bills:
        index = indexes[bill.id]
        next_index = 0 if index is None else index + 1
        next_due = occurrence(bill.first_due_date, bill.frequency, next_index)
        low_next, high_next = window(bill.first_due_date, bill.frequency, next_index)
        if index is None:
            last_due, state = None, "upcoming"
        else:
            last_due = occurrence(bill.first_due_date, bill.frequency, index)
            low, high = window(bill.first_due_date, bill.frequency, index)
            state = "paid" if _paid(payments[bill.id], low, high) else "overdue"
        items.append(
            {
                **bill_output(bill, places[bill.currency_code]),
                "last_due_date": last_due,
                "next_due_date": next_due,
                "status": state,
                "next_due_paid": _paid(payments[bill.id], low_next, high_next),
            }
        )
    items.sort(key=lambda item: (item["next_due_date"], item["name"].lower(), str(item["id"])))
    return items


# ---------- Ligacao automatica ----------


def find_matching_bill(
    db: Session, user_id: uuid.UUID, currency_code: str, amount: Decimal, texts: Sequence[str]
) -> Bill | None:
    """A conta a pagar que combina com a saida, ou None. So liga se exatamente UMA combinar:
    com duas candidatas o app nao chuta, e a pessoa escolhe. Combina quem esta ativa, na mesma
    moeda, com o valor dentro da faixa e o texto da conta presente em alguma das `texts`."""
    candidates = (
        db.execute(
            select(Bill).where(
                Bill.user_id == user_id,
                Bill.active.is_(True),
                Bill.currency_code == currency_code,
                Bill.match_text.is_not(None),
                Bill.amount_min <= amount,
                Bill.amount_max >= amount,
            )
        )
        .scalars()
        .all()
    )
    haystacks = [text.lower() for text in texts]
    found = [bill for bill in candidates if any(bill.match_text.lower() in text for text in haystacks)]
    return found[0] if len(found) == 1 else None

import calendar
import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models.account import Account, AccountRole
from app.models.currency import Currency
from app.models.transaction import TransactionSplit, TransactionType
from app.services.accounts import get_owned_account, quantize_money

# ---------- Periodo e vencimento da fatura (funcoes puras) ----------


def _day_in_month(year: int, month: int, day: int) -> date:
    """O dia `day` daquele mes, preso ao ultimo dia quando o mes e mais curto (dia 31 em fevereiro vira 28)."""
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def period_for(on: date, closing_day: int) -> tuple[date, date]:
    """Periodo de fatura que contem a data `on`: do dia seguinte ao fechamento anterior ate o
    proximo fechamento (inclusive). Uma compra no proprio dia do fechamento ainda entra nele."""
    this_closing = _day_in_month(on.year, on.month, closing_day)
    if on <= this_closing:
        period_end = this_closing
    else:
        next_month = on.month % 12 + 1
        next_year = on.year + (1 if on.month == 12 else 0)
        period_end = _day_in_month(next_year, next_month, closing_day)

    # Inicio = dia seguinte ao fechamento anterior ao `period_end`
    prev_month = period_end.month - 1 or 12
    prev_year = period_end.year - (1 if period_end.month == 1 else 0)
    prev_closing = _day_in_month(prev_year, prev_month, closing_day)
    period_start = prev_closing + timedelta(days=1)
    return period_start, period_end


def due_date_for(period_end: date, due_day: int) -> date:
    """Vencimento daquele periodo. Quando o dia de vencimento e menor ou igual ao de fechamento,
    o vencimento e sempre no mes seguinte ao fechamento (o caso comum: fecha dia 28, vence dia 5)."""
    if due_day > period_end.day:
        return _day_in_month(period_end.year, period_end.month, due_day)
    next_month = period_end.month % 12 + 1
    next_year = period_end.year + (1 if period_end.month == 12 else 0)
    return _day_in_month(next_year, next_month, due_day)


# ---------- Consulta ----------


def _require_credit_card(account: Account) -> None:
    if account.role != AccountRole.credit_card or account.closing_day is None or account.due_day is None:
        raise AppError(
            400,
            ErrorCode.ACCOUNT_NOT_CREDIT_CARD,
            "Esta conta nao e um cartao de credito com dia de fechamento e de vencimento configurados",
        )


def invoice(db: Session, user_id: uuid.UUID, account_id: uuid.UUID, on: date) -> dict:
    account = get_owned_account(db, user_id, account_id)
    _require_credit_card(account)

    period_start, period_end = period_for(on, account.closing_day)
    due_date = due_date_for(period_end, account.due_day)

    splits = list(
        db.execute(
            select(TransactionSplit)
            .where(
                TransactionSplit.source_account_id == account.id,
                TransactionSplit.type == TransactionType.withdrawal,
                TransactionSplit.date >= period_start,
                TransactionSplit.date <= period_end,
            )
            .order_by(TransactionSplit.date, TransactionSplit.id)
        )
        .scalars()
        .all()
    )
    decimal_places = db.scalar(select(Currency.decimal_places).where(Currency.code == account.currency_code))
    total = quantize_money(sum((split.amount for split in splits), Decimal(0)), decimal_places)

    return {
        "account_id": account.id,
        "currency_code": account.currency_code,
        "period_start": period_start,
        "period_end": period_end,
        "due_date": due_date,
        "total": total,
        "splits": [
            {
                "id": split.id,
                "date": split.date,
                "description": split.description,
                "amount": split.amount,
                "currency_code": split.currency_code,
            }
            for split in splits
        ],
    }

import calendar
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import and_, case, exists, func, literal, or_, select
from sqlalchemy.orm import Session, aliased

from app.core import clock
from app.models.account import Account, AccountType
from app.models.budget import Budget
from app.models.category import Category
from app.models.currency import Currency
from app.models.tag import Tag
from app.models.transaction import TransactionSplit, TransactionType, transaction_split_tags
from app.services.accounts import quantize_money
from app.services.budgets import get_owned_budget
from app.services.transactions import get_owned_category, get_owned_counterparty, get_owned_tags

# O grafico mensal nao passa de 10 anos: cada mes vira um ponto por moeda
MAX_MONTHS = 120

NO_CATEGORY = "Sem categoria"
NO_BUDGET = "Sem orcamento"
NO_TAG = "Sem tag"

ZERO = Decimal("0")


@dataclass(frozen=True)
class ReportFilters:
    date_from: date
    date_to: date
    account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    tag_id: uuid.UUID | None = None
    budget_id: uuid.UUID | None = None


def month_bounds(day: date) -> tuple[date, date]:
    return day.replace(day=1), day.replace(day=calendar.monthrange(day.year, day.month)[1])


def resolve_period(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    """Periodo do relatorio. Sem nenhuma data, o mes atual (pelo relogio do app). Com so uma,
    a outra fecha o mes da que veio, para o periodo nunca ficar ao contrario."""
    if date_from is None and date_to is None:
        return month_bounds(clock.today())
    if date_from is None:
        return month_bounds(date_to)[0], date_to
    if date_to is None:
        return date_from, month_bounds(date_from)[1]
    return date_from, date_to


PRESETS = ("this-month", "last-month", "this-year")


def preset_period(preset: str, today: date) -> tuple[date, date]:
    """Periodos prontos, contados a partir de `today` (o dia do relogio do app, nao do navegador)."""
    if preset == "this-month":
        return month_bounds(today)
    if preset == "last-month":
        return month_bounds(today.replace(day=1) - timedelta(days=1))
    if preset == "this-year":
        return date(today.year, 1, 1), date(today.year, 12, 31)
    raise ValueError(f"Periodo desconhecido: {preset}")


def months_between(date_from: date, date_to: date) -> list[str]:
    """Todos os meses (AAAA-MM) que o periodo toca, do primeiro ao ultimo."""
    months = []
    year, month = date_from.year, date_from.month
    while (year, month) <= (date_to.year, date_to.month):
        months.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def check_filters_owned(db: Session, user_id: uuid.UUID, filters: ReportFilters) -> None:
    """404 para conta, categoria, tag ou orcamento que nao e do usuario (ou nao existe)."""
    if filters.account_id is not None:
        get_owned_counterparty(db, user_id, filters.account_id)
    if filters.category_id is not None:
        get_owned_category(db, user_id, filters.category_id)
    if filters.tag_id is not None:
        get_owned_tags(db, user_id, [filters.tag_id])
    if filters.budget_id is not None:
        get_owned_budget(db, user_id, filters.budget_id)


# ---------- Consulta base ----------


class _Base:
    """Pedacos de SQL compartilhados: o que e receita, o que e despesa e os filtros.

    Receita: deposito vindo de conta de receita. Despesa: saque para conta de despesa.
    Transferencia, pagamento de divida, saldo inicial e conciliacao ficam de fora.
    """

    def __init__(self, user_id: uuid.UUID, filters: ReportFilters):
        self.split = TransactionSplit
        self.source = aliased(Account)
        self.destination = aliased(Account)
        is_income = and_(
            self.split.type == TransactionType.deposit, self.source.type == AccountType.revenue
        )
        is_expense = and_(
            self.split.type == TransactionType.withdrawal, self.destination.type == AccountType.expense
        )
        self.income = func.coalesce(func.sum(case((is_income, self.split.amount), else_=literal(ZERO))), ZERO)
        self.expense = func.coalesce(func.sum(case((is_expense, self.split.amount), else_=literal(ZERO))), ZERO)
        self.count = func.count()

        self.conditions = [
            self.split.user_id == user_id,
            or_(is_income, is_expense),
            self.split.date >= filters.date_from,
            self.split.date <= filters.date_to,
        ]
        if filters.account_id is not None:
            self.conditions.append(
                or_(
                    self.split.source_account_id == filters.account_id,
                    self.split.destination_account_id == filters.account_id,
                )
            )
        if filters.category_id is not None:
            self.conditions.append(self.split.category_id == filters.category_id)
        if filters.budget_id is not None:
            self.conditions.append(self.split.budget_id == filters.budget_id)
        if filters.tag_id is not None:
            # Apelido proprio: no relatorio por tag a tabela tambem entra no JOIN da consulta
            wanted = transaction_split_tags.alias("wanted_tag")
            self.conditions.append(
                exists().where(
                    wanted.c.transaction_split_id == self.split.id,
                    wanted.c.tag_id == filters.tag_id,
                )
            )

    def select(self, *columns):
        return (
            select(*columns, self.income, self.expense, self.count)
            .select_from(self.split)
            .join(self.source, self.source.id == self.split.source_account_id)
            .join(self.destination, self.destination.id == self.split.destination_account_id)
        )


def _places(db: Session, codes: set[str]) -> dict[str, int]:
    if not codes:
        return {}
    return dict(db.execute(select(Currency.code, Currency.decimal_places).where(Currency.code.in_(codes))).all())


def _amounts(income: Decimal, expense: Decimal, places: int) -> dict:
    return {
        "income": quantize_money(income, places),
        "expense": quantize_money(expense, places),
        "net": quantize_money(income - expense, places),
    }


# ---------- Relatorios ----------


def summary(db: Session, user_id: uuid.UUID, filters: ReportFilters) -> dict:
    check_filters_owned(db, user_id, filters)
    return {
        "date_from": filters.date_from,
        "date_to": filters.date_to,
        "currencies": _totals(db, user_id, filters),
    }


def _totals(db: Session, user_id: uuid.UUID, filters: ReportFilters) -> list[dict]:
    base = _Base(user_id, filters)
    statement = (
        base.select(base.split.currency_code)
        .where(*base.conditions)
        .group_by(base.split.currency_code)
        .order_by(base.split.currency_code)
    )
    rows = db.execute(statement).all()
    places = _places(db, {row[0] for row in rows})
    return [
        {"currency_code": code, **_amounts(income, expense, places[code]), "count": count}
        for code, income, expense, count in rows
    ]


def _grouped_statement(dimension: str, base: _Base):
    """Consulta que agrupa por moeda e pela dimensao (id e nome), com uma linha "sem ..." se houver."""
    split = base.split
    if dimension == "category":
        statement = base.select(split.currency_code, split.category_id, Category.name).outerjoin(
            Category, Category.id == split.category_id
        )
        keys = (split.category_id, Category.name)
        fallback = NO_CATEGORY
    elif dimension == "budget":
        statement = base.select(split.currency_code, split.budget_id, Budget.name).outerjoin(
            Budget, Budget.id == split.budget_id
        )
        keys = (split.budget_id, Budget.name)
        fallback = NO_BUDGET
    elif dimension == "tag":
        # Um split com varias tags aparece uma vez em cada tag
        statement = (
            base.select(split.currency_code, Tag.id, Tag.name)
            .outerjoin(transaction_split_tags, transaction_split_tags.c.transaction_split_id == split.id)
            .outerjoin(Tag, Tag.id == transaction_split_tags.c.tag_id)
        )
        keys = (Tag.id, Tag.name)
        fallback = NO_TAG
    else:
        # A conta do usuario e a que recebe no deposito e a que paga no saque
        own_account_id = case((split.type == TransactionType.deposit, split.destination_account_id), else_=split.source_account_id)
        own = aliased(Account)
        statement = base.select(split.currency_code, own.id, own.name).join(own, own.id == own_account_id)
        keys = (own.id, own.name)
        fallback = ""
    statement = (
        statement.where(*base.conditions)
        .group_by(split.currency_code, *keys)
        .order_by(split.currency_code, base.expense.desc(), base.income.desc(), func.lower(keys[1]), keys[0])
    )
    return statement, fallback


def grouped(db: Session, user_id: uuid.UUID, filters: ReportFilters, dimension: str) -> dict:
    """Receita e despesa por categoria, tag, orcamento ou conta, separadas por moeda."""
    check_filters_owned(db, user_id, filters)
    totals = _totals(db, user_id, filters)

    base = _Base(user_id, filters)
    statement, fallback = _grouped_statement(dimension, base)
    rows_by_currency: dict[str, list[dict]] = defaultdict(list)
    places = _places(db, {block["currency_code"] for block in totals})
    for code, key, name, income, expense, count in db.execute(statement).all():
        rows_by_currency[code].append(
            {"id": key, "name": name if key is not None else fallback, **_amounts(income, expense, places[code]), "count": count}
        )

    return {
        "date_from": filters.date_from,
        "date_to": filters.date_to,
        "currencies": [{**block, "rows": rows_by_currency[block["currency_code"]]} for block in totals],
    }


def monthly(db: Session, user_id: uuid.UUID, filters: ReportFilters) -> dict:
    """Serie mensal por moeda. Os meses sem movimento dentro do periodo entram com zeros."""
    check_filters_owned(db, user_id, filters)
    base = _Base(user_id, filters)
    month = func.to_char(base.split.date, "YYYY-MM")
    statement = (
        base.select(base.split.currency_code, month)
        .where(*base.conditions)
        .group_by(base.split.currency_code, month)
    )
    found: dict[str, dict[str, tuple]] = defaultdict(dict)
    for code, key, income, expense, count in db.execute(statement).all():
        found[code][key] = (income, expense, count)

    places = _places(db, set(found))
    all_months = months_between(filters.date_from, filters.date_to)
    blocks = []
    for code in sorted(found):
        points = []
        for key in all_months:
            income, expense, count = found[code].get(key, (ZERO, ZERO, 0))
            points.append({"month": key, **_amounts(income, expense, places[code]), "count": count})
        blocks.append({"currency_code": code, "months": points})
    return {"date_from": filters.date_from, "date_to": filters.date_to, "currencies": blocks}

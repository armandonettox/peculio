import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field

# Dinheiro como texto no JSON, com as casas da moeda (JPY sem casas)
Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]


class ReportTotals(BaseModel):
    """Receita, despesa e resultado de uma moeda. Moedas diferentes nunca se somam."""

    currency_code: str
    income: Money
    expense: Money
    net: Money
    count: int


class SummaryOut(BaseModel):
    date_from: date
    date_to: date
    currencies: list[ReportTotals]


class ReportRow(BaseModel):
    # null na linha "sem categoria", "sem orcamento" ou "sem tag"
    id: uuid.UUID | None
    name: str
    income: Money
    expense: Money
    net: Money
    count: int


class ReportGroupBlock(ReportTotals):
    # Maior gasto primeiro. Na tag, um lancamento com varias tags aparece em varias linhas,
    # entao a soma das linhas pode passar do total do bloco (que nao repete o lancamento).
    rows: list[ReportRow]


class GroupedReportOut(BaseModel):
    date_from: date
    date_to: date
    currencies: list[ReportGroupBlock]


class MonthlyPoint(BaseModel):
    # AAAA-MM; os meses sem movimento aparecem com zeros
    month: str
    income: Money
    expense: Money
    net: Money
    count: int


class MonthlyBlock(BaseModel):
    currency_code: str
    months: list[MonthlyPoint]


class MonthlyReportOut(BaseModel):
    date_from: date
    date_to: date
    currencies: list[MonthlyBlock]

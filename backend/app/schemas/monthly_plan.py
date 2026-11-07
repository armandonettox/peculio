import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.monthly_plan import CardCounting

Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(max_digits=18, decimal_places=2, gt=0)]
NonNegativeMoney = Annotated[Decimal, Field(max_digits=18, decimal_places=2, ge=0)]
Percent = Annotated[Decimal, Field(max_digits=5, decimal_places=2, ge=0, le=100)]


class PlanItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: uuid.UUID
    amount: PositiveMoney
    alert: bool = False


class MonthlyPlanCreate(BaseModel):
    """Cria o planejamento de um mes (o mes vai na URL)."""

    model_config = ConfigDict(extra="forbid")

    income: NonNegativeMoney
    savings_percent: Percent = Decimal("20")
    card_counting: CardCounting = CardCounting.purchase
    # Omitida: a moeda padrao do usuario
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    items: list[PlanItemIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def no_repeated_category(self):
        ids = [item.category_id for item in self.items]
        if len(set(ids)) != len(ids):
            raise ValueError("Ha categorias repetidas no planejamento")
        return self


class MonthlyPlanUpdate(BaseModel):
    """Muda so o cabecalho (o que veio no corpo); os limites por categoria tem as proprias rotas."""

    model_config = ConfigDict(extra="forbid")

    income: NonNegativeMoney | None = None
    savings_percent: Percent | None = None
    card_counting: CardCounting | None = None


class PlanItemsIn(BaseModel):
    """Grava varios limites de uma vez: cria os novos e troca o valor e o alerta dos que ja existem."""

    model_config = ConfigDict(extra="forbid")

    items: list[PlanItemIn] = Field(min_length=1)

    @model_validator(mode="after")
    def no_repeated_category(self):
        ids = [item.category_id for item in self.items]
        if len(set(ids)) != len(ids):
            raise ValueError("Ha categorias repetidas na lista")
        return self


class PlanRowOut(BaseModel):
    # None na linha "Categorias restantes" (tudo o que nao tem limite proprio)
    category_id: uuid.UUID | None
    category_name: str | None
    category_color: str | None
    category_icon: str | None
    kind: Literal["category", "rest"]
    planned: Money
    # Gasto ja pago (efetivado) e ainda previsto (nao pago) dentro do mes
    paid: Money
    expected: Money
    total: Money
    # Quanto resta do limite (negativo se passou)
    remaining: Money
    alert: bool
    # ok, near (a partir de 80% do limite) ou exceeded (passou do limite)
    state: Literal["ok", "near", "exceeded"]


class PlanSummaryOut(BaseModel):
    # Receita de verdade do mes (somada dos lancamentos), nao a renda informada
    month_income: Money
    # O orcamento de gastos do mes
    planned_spending: Money
    planned_balance: Money
    # Balanco planejado sobre a receita do mes, em porcentagem (0 se nao houve receita)
    planned_savings_percent: Decimal
    spent_paid: Money
    spent_expected: Money
    spent_total: Money
    remaining: Money


class MonthlyPlanOut(BaseModel):
    month: dt.date
    currency_code: str
    income: Money
    savings_percent: Percent
    card_counting: CardCounting
    # Renda menos a economia desejada: o total que pode ser gasto no mes
    spending_budget: Money
    savings_amount: Money
    summary: PlanSummaryOut
    rows: list[PlanRowOut]

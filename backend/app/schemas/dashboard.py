"""Contrato da API do painel inicial (Fase 3).

O painel reaproveita as APIs que ja existem (relatorios, orcamentos, contas a pagar, transacoes,
cofrinhos). Estes sao os dois pedaços que faltavam: a evolucao do patrimonio e os proximos
vencimentos.
"""

import uuid
from datetime import date as DateType
from typing import Literal

from pydantic import BaseModel

from app.schemas.transaction import Money


class NetWorthPoint(BaseModel):
    """Saldo no FIM do mes `month` (AAAA-MM). No mes atual, o saldo ate hoje (`as_of`)."""

    month: str
    # Soma dos saldos das contas de ativo
    assets: Money
    # Soma dos saldos das contas de passivo (dividas). Negativo quando se deve: o patrimonio e assets + liabilities
    liabilities: Money
    net: Money


class NetWorthCurrency(BaseModel):
    """Patrimonio de uma moeda. Moedas nunca se misturam: cada uma tem a sua serie, sem conversao."""

    currency_code: str
    # Valores de hoje (`as_of`); o ultimo ponto da serie e igual a eles
    assets: Money
    liabilities: Money
    net: Money
    # Do mais antigo ao mais recente, um ponto por mes, `months` pontos no total
    series: list[NetWorthPoint]


class NetWorthOut(BaseModel):
    # Dia do relogio do app (APP_TIMEZONE), nao do navegador
    as_of: DateType
    months: int
    # Uma entrada por moeda que tem conta de ativo ou de passivo; ordenadas pelo codigo da moeda
    currencies: list[NetWorthCurrency]


class UpcomingItem(BaseModel):
    kind: Literal["bill", "recurrence"]
    id: uuid.UUID
    name: str
    # Proxima data (vencimento da conta a pagar ou proxima ocorrencia da recorrente)
    date: DateType
    # Negativo quando ja passou (atrasada)
    days_until: int
    overdue: bool
    # Conta a pagar e sempre "out"; recorrente segue o tipo do primeiro lancamento do modelo
    direction: Literal["out", "in", "transfer"]
    currency_code: str
    # Conta a pagar tem faixa de valor; recorrente tem valor unico (min == max)
    amount_min: Money
    amount_max: Money


class UpcomingOut(BaseModel):
    as_of: DateType
    days: int
    # Atrasadas primeiro (da mais antiga), depois por data e por nome; no maximo 50 itens
    items: list[UpcomingItem]

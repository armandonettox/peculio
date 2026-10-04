"""Conta da conciliacao, sem banco de dados: so valores entram, numeros saem."""

from decimal import Decimal

ZERO = Decimal("0")


def difference(statement_balance: Decimal, cleared_balance: Decimal) -> Decimal:
    """O que falta para o conferido bater com o extrato. Positivo: o extrato tem mais dinheiro do que o conferido
    (falta uma entrada ou sobrou uma saida); negativo: o conferido tem mais do que o extrato."""
    return statement_balance - cleared_balance


def is_reconciled(diff: Decimal) -> bool:
    return diff == ZERO


def adjustment(diff: Decimal) -> tuple[str, Decimal] | None:
    """O lancamento que zera a diferenca: ("deposit", valor) se faltou entrada, ("withdrawal", valor) se faltou
    saida. None quando nao ha diferenca."""
    if diff == ZERO:
        return None
    return ("deposit", diff) if diff > ZERO else ("withdrawal", -diff)


def signed_effect(is_destination: bool, amount: Decimal) -> Decimal:
    """O efeito de um lancamento na conta: entra (+) quando ela e o destino, sai (-) quando e a origem."""
    return amount if is_destination else -amount

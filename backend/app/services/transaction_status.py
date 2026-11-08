"""Situacao de um lancamento, para o filtro "Situacoes" da tela de transacoes (igual ao do Mobills).

Uma regra so, usada pela lista, pela exportacao em CSV e pelo resumo dos cartoes, para os tres nunca discordarem."""

from typing import Literal

from sqlalchemy import ColumnElement, select

from app.models.recurrence import Recurrence
from app.models.transaction import Transaction, TransactionSplit

# done: efetivada (paga ou recebida). pending: ainda nao efetivada. fixed: veio de uma recorrencia sem fim (despesa,
# receita ou transferencia fixa). ignored: marcada para ficar fora dos totais.
TransactionStatus = Literal["done", "pending", "fixed", "ignored"]


def status_condition(status: TransactionStatus) -> ColumnElement[bool]:
    """Condicao sobre o split. O filtro escolhe uma situacao so, como no Mobills.

    Nao ha exclusao entre elas: um lancamento ignorado e pago aparece em "done" e em "ignored"."""
    if status == "done":
        return TransactionSplit.is_paid.is_(True)
    if status == "pending":
        return TransactionSplit.is_paid.is_(False)
    if status == "ignored":
        return TransactionSplit.ignored.is_(True)
    # fixed: "Repetir" (com numero de vezes ou data final) tambem e uma recorrencia, mas nao e "fixa"
    return TransactionSplit.transaction_id.in_(
        select(Transaction.id)
        .join(Recurrence, Recurrence.id == Transaction.recurrence_id)
        .where(Recurrence.end_date.is_(None), Recurrence.max_occurrences.is_(None))
    )

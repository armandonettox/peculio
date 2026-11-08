"""lembretes de conta a pagar viram recorrencia automatica pendente (fixa + pendente, como o Mobills)

Revision ID: 0043
Revises: 0042
Create Date: 2026-11-08

Cada lembrete ativo (recorrencia sem auto_create) vira uma recorrencia automatica cujo modelo cria um lancamento
**pendente** (is_paid falso) a cada vencimento. O lembrete antigo nao e apagado: fica arquivado (active = false), com os
lancamentos que ele ligou, para a Fase 4 limpar depois.

Regras de conversao (escolhidas pelo usuario):
- Com historico (algum lancamento ligado ao lembrete): conta, contraparte, categoria, orcamento, tags e valor vem do ultimo
  lancamento ligado.
- Sem historico: a conta e a que mais aparece nos pagamentos dos outros lembretes do mesmo usuario e do mesmo sentido (e
  da mesma moeda do lembrete), o valor e o maximo da faixa e a contraparte e o nome do lembrete. Sem nenhum pagamento
  para aprender a conta, o lembrete continua como estava e a migracao avisa.
- A recorrencia nova comeca no vencimento mais antigo que ficou sem pagar (o motor recria cada ocorrencia passada com a
  propria data, como pendente: aparecem como atrasadas no painel) ou, sem atraso, no proximo vencimento.
- Fim: a data final e copiada; o limite de ocorrencias vira o que sobra. Lembrete que ja terminou so e arquivado.

A janela de pagamento (qual pagamento quita qual vencimento) repete a regra do app; esta copia fica aqui para a
migracao nao depender de codigo que muda.
"""
import calendar
import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from alembic import op
import sqlalchemy as sa

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None

MONTH_STEP = {"monthly": 1, "quarterly": 3, "half_yearly": 6, "yearly": 12}


def occurrence(first: date, frequency: str, index: int) -> date:
    if frequency == "daily":
        return first + timedelta(days=index)
    if frequency == "weekly":
        return first + timedelta(days=7 * index)
    total = first.month - 1 + MONTH_STEP[frequency] * index
    year, month = first.year + total // 12, total % 12 + 1
    return date(year, month, min(first.day, calendar.monthrange(year, month)[1]))


def latest_index(first: date, frequency: str, on: date):
    if on < first:
        return None
    if frequency == "daily":
        return (on - first).days
    if frequency == "weekly":
        return (on - first).days // 7
    months = (on.year - first.year) * 12 + (on.month - first.month)
    index = months // MONTH_STEP[frequency]
    while occurrence(first, frequency, index) > on:
        index -= 1
    return index


def _midpoint(start: date, end: date) -> date:
    return start + timedelta(days=(end - start).days // 2)


def window(first: date, frequency: str, index: int):
    due = occurrence(first, frequency, index)
    low = None if index == 0 else _midpoint(occurrence(first, frequency, index - 1), due)
    high = _midpoint(due, occurrence(first, frequency, index + 1))
    return low, high


def is_paid(payments, low, high) -> bool:
    return any((low is None or day > low) and day <= high for day in payments)


def start_index(first: date, frequency: str, payments, today: date) -> int:
    """O numero do primeiro vencimento a virar pendente: o mais antigo da sequencia atual sem pagar, ou o seguinte ao
    ultimo vencimento que ja chegou quando ele esta pago (ou 0 se a primeira data ainda esta no futuro)."""
    last = latest_index(first, frequency, today)
    if last is None:
        return 0
    low, high = window(first, frequency, last)
    if is_paid(payments, low, high):
        return last + 1
    index = last
    while index >= 0:
        low, high = window(first, frequency, index)
        if is_paid(payments, low, high):
            break
        index -= 1
    return index + 1


def app_today() -> date:
    try:
        return datetime.now(ZoneInfo(os.environ.get("APP_TIMEZONE", "America/Sao_Paulo"))).date()
    except Exception:  # sem tzdata: o dia em UTC erra, no maximo, por uma noite
        return datetime.now(timezone.utc).date()


def upgrade() -> None:
    bind = op.get_bind()
    today = app_today()
    reminders = bind.execute(
        sa.text(
            "SELECT id, user_id, name, type, frequency, first_date, end_date, max_occurrences, currency_code, amount_max "
            "FROM recurrences WHERE NOT auto_create AND active ORDER BY created_at, id"
        )
    ).mappings().all()

    for reminder in reminders:
        first = reminder["first_date"]
        frequency = reminder["frequency"]
        kind = reminder["type"]
        own_column = "source_account_id" if kind == "withdrawal" else "destination_account_id"
        other_column = "destination_account_id" if kind == "withdrawal" else "source_account_id"

        payments = [
            row[0]
            for row in bind.execute(
                sa.text("SELECT date FROM transaction_splits WHERE bill_id = :id"), {"id": reminder["id"]}
            ).all()
        ]
        index = start_index(first, frequency, payments, today)
        start = occurrence(first, frequency, index)

        # Terminou: sem nada a criar daqui para frente, so arquiva
        ended = (reminder["max_occurrences"] is not None and index >= reminder["max_occurrences"]) or (
            reminder["end_date"] is not None and start > reminder["end_date"]
        )
        if ended:
            bind.execute(sa.text("UPDATE recurrences SET active = false WHERE id = :id"), {"id": reminder["id"]})
            continue

        last = bind.execute(
            sa.text(
                f"SELECT id, amount, currency_code, category_id, budget_id, {own_column} AS own, {other_column} AS other "
                "FROM transaction_splits WHERE bill_id = :id ORDER BY date DESC, position DESC, id DESC LIMIT 1"
            ),
            {"id": reminder["id"]},
        ).mappings().first()

        split = {
            "type": kind,
            "date": start.isoformat(),
            "description": reminder["name"],
            "currency_code": reminder["currency_code"],
            "bill_id": None,
            "is_paid": False,
        }
        if last is not None:
            split.update(
                account_id=str(last["own"]),
                counterparty_account_id=str(last["other"]),
                amount=str(last["amount"]),
                currency_code=last["currency_code"],
            )
            if last["category_id"] is not None:
                split["category_id"] = str(last["category_id"])
            if last["budget_id"] is not None:
                split["budget_id"] = str(last["budget_id"])
            tags = [
                str(row[0])
                for row in bind.execute(
                    sa.text("SELECT tag_id FROM transaction_split_tags WHERE transaction_split_id = :id ORDER BY tag_id"),
                    {"id": last["id"]},
                ).all()
            ]
            if tags:
                split["tag_ids"] = tags
        else:
            usual = bind.execute(
                sa.text(
                    f"SELECT s.{own_column} AS account, count(*) AS total "
                    "FROM transaction_splits s "
                    "JOIN recurrences r ON r.id = s.bill_id "
                    f"JOIN accounts a ON a.id = s.{own_column} "
                    "WHERE r.user_id = :user AND NOT r.auto_create AND r.type = :kind AND a.currency_code = :currency "
                    f"GROUP BY s.{own_column} ORDER BY total DESC, account LIMIT 1"
                ),
                {"user": reminder["user_id"], "kind": kind, "currency": reminder["currency_code"]},
            ).mappings().first()
            if usual is None:
                print(f"0043: lembrete '{reminder['name']}' nao convertido: sem pagamento de onde aprender a conta")
                continue
            split.update(
                account_id=str(usual["account"]),
                counterparty_name=reminder["name"],
                amount=str(reminder["amount_max"]),
            )

        max_left = None if reminder["max_occurrences"] is None else reminder["max_occurrences"] - index
        bind.execute(
            sa.text(
                "INSERT INTO recurrences (id, user_id, name, frequency, first_date, end_date, max_occurrences, active, "
                "auto_create, template, next_index, next_date) VALUES (:id, :user, :name, :frequency, :first, :end, "
                ":max, true, true, CAST(:template AS JSON), 0, :first)"
            ),
            {
                "id": uuid.uuid4(),
                "user": reminder["user_id"],
                "name": reminder["name"],
                "frequency": frequency,
                "first": start,
                "end": reminder["end_date"],
                "max": max_left,
                "template": json.dumps({"splits": [split]}),
            },
        )
        bind.execute(sa.text("UPDATE recurrences SET active = false WHERE id = :id"), {"id": reminder["id"]})


def downgrade() -> None:
    # Migracao de dados: nao ha como saber quais lembretes foram arquivados por ela, entao nao desfaz nada. Os lembretes
    # antigos continuam arquivados (e podem ser reativados), e as recorrencias novas continuam existindo.
    pass

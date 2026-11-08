"""Migration 0043: lembretes de conta a pagar viram recorrencia automatica pendente (fixa + pendente, como o Mobills)."""

import json
import os
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from alembic import command
from sqlalchemy import text

from app.core.database import SessionLocal, engine
from app.schemas.transaction import TransactionCreate
from app.services import recurrences as recurrence_service
from tests.conftest import alembic_config

TODAY = datetime.now(ZoneInfo(os.environ.get("APP_TIMEZONE", "America/Sao_Paulo"))).date()


def days(offset: int):
    return TODAY + timedelta(days=offset)


def new_id() -> str:
    return str(uuid.uuid4())


class World:
    """Um banco no estado da migration 0042, com usuarios, contas, lembretes e os lancamentos que eles ligaram."""

    def __init__(self, conn):
        self.conn = conn
        self.user = self.add_user("ana@example.com")

    def add_user(self, email):
        user = new_id()
        self.conn.execute(
            text("INSERT INTO users (id, name, email, hashed_password) VALUES (:id, 'Ana', :email, 'x')"),
            {"id": user, "email": email},
        )
        return user

    def account(self, user, name, kind):
        account = new_id()
        self.conn.execute(
            text("INSERT INTO accounts (id, user_id, name, type, currency_code) VALUES (:id, :user, :name, :kind, 'BRL')"),
            {"id": account, "user": user, "name": name, "kind": kind},
        )
        return account

    def reminder(self, user, name, first, frequency="weekly", kind="withdrawal", low="10.00", high="20.00", active=True, **extra):
        reminder = new_id()
        self.conn.execute(
            text(
                "INSERT INTO recurrences (id, user_id, name, frequency, first_date, end_date, max_occurrences, active, "
                "auto_create, currency_code, amount_min, amount_max, type) VALUES (:id, :user, :name, :frequency, :first, "
                ":end, :max, :active, false, 'BRL', :low, :high, :kind)"
            ),
            {
                "id": reminder,
                "user": user,
                "name": name,
                "frequency": frequency,
                "first": first,
                "end": extra.get("end_date"),
                "max": extra.get("max_occurrences"),
                "active": active,
                "low": low,
                "high": high,
                "kind": kind,
            },
        )
        return reminder

    def payment(self, user, reminder, on, own, other, amount, category=None, tag=None, kind="withdrawal"):
        transaction, split = new_id(), new_id()
        self.conn.execute(text("INSERT INTO transactions (id, user_id) VALUES (:id, :user)"), {"id": transaction, "user": user})
        source, destination = (own, other) if kind == "withdrawal" else (other, own)
        self.conn.execute(
            text(
                "INSERT INTO transaction_splits (id, transaction_id, user_id, type, date, description, source_account_id, "
                "destination_account_id, amount, currency_code, bill_id, category_id) VALUES (:id, :tx, :user, :kind, :on, "
                "'Pagamento', :source, :destination, :amount, 'BRL', :bill, :category)"
            ),
            {
                "id": split,
                "tx": transaction,
                "user": user,
                "kind": kind,
                "on": on,
                "source": source,
                "destination": destination,
                "amount": amount,
                "bill": reminder,
                "category": category,
            },
        )
        if tag:
            self.conn.execute(
                text("INSERT INTO transaction_split_tags (transaction_split_id, tag_id) VALUES (:split, :tag)"),
                {"split": split, "tag": tag},
            )


def recurrences_by_name(conn, auto: bool):
    rows = conn.execute(
        text(
            "SELECT name, active, first_date, end_date, max_occurrences, template, next_date FROM recurrences "
            "WHERE auto_create = :auto ORDER BY name"
        ),
        {"auto": auto},
    ).mappings()
    return {row["name"]: row for row in rows}


def build_world(conn):
    world = World(conn)
    user = world.user
    itau = world.account(user, "Itau", "asset")
    nubank = world.account(user, "Nubank", "asset")
    locador = world.account(user, "Locador", "expense")
    provedor = world.account(user, "Provedor", "expense")
    category, tag = new_id(), new_id()
    conn.execute(
        text("INSERT INTO categories (id, user_id, name, kind) VALUES (:id, :user, 'Casa', 'expense')"),
        {"id": category, "user": user},
    )
    conn.execute(text("INSERT INTO tags (id, user_id, name) VALUES (:id, :user, 'fixo')"), {"id": tag, "user": user})

    # Em dia: pagou todos os vencimentos ate hoje (inclusive o de hoje), o proximo e daqui a 7 dias
    aluguel = world.reminder(user, "Aluguel", days(-21), low="1800.00", high="1900.00")
    for offset, amount in [(-21, "1850.00"), (-14, "1850.00"), (-7, "1850.00"), (0, "1880.00")]:
        world.payment(user, aluguel, days(offset), itau, locador, amount, category=category, tag=tag if offset == 0 else None)

    # Atrasado: pagou so o primeiro de quatro vencimentos
    internet = world.reminder(user, "Internet", days(-21), low="110.00", high="130.00")
    world.payment(user, internet, days(-21), nubank, provedor, "120.00")

    # Sem nenhum pagamento: aprende a conta (Itau tem mais pagamentos que Nubank) e usa o maximo da faixa
    world.reminder(user, "Cinema", days(-14), low="40.00", high="60.00")

    # Ja terminou (3 vencimentos e os tres ja passaram sem pagar o ultimo): so arquiva
    seguro = world.reminder(user, "Seguro", days(-35), max_occurrences=3, low="290.00", high="320.00")
    for offset in (-35, -28, -21):
        world.payment(user, seguro, days(offset), itau, locador, "300.00")

    # Com data final
    world.reminder(user, "Curso", days(-7), end_date=days(3), low="80.00", high="90.00")

    # Com limite de ocorrencias: pagou os dois primeiros de dez, o terceiro (hoje) esta sem pagar
    plano = world.reminder(user, "Plano", days(-14), max_occurrences=10, low="70.00", high="75.00")
    world.payment(user, plano, days(-14), itau, provedor, "72.00")
    world.payment(user, plano, days(-7), itau, provedor, "72.00")

    # Receita (deposito): a conta e o destino
    salario_conta = world.account(user, "Fonte", "revenue")
    bonus = world.reminder(user, "Bonus", days(-7), kind="deposit", low="500.00", high="600.00")
    world.payment(user, bonus, days(-7), itau, salario_conta, "550.00", kind="deposit")

    # Ja arquivado pelo usuario: fica como esta
    world.reminder(user, "Velho", days(-60), active=False)

    # Outro usuario, sem nenhum pagamento para aprender a conta: nao converte e nao inventa
    other = world.add_user("bia@example.com")
    world.account(other, "Banco", "asset")
    world.reminder(other, "Orfao", days(-14))
    return world, {"itau": itau, "nubank": nubank, "locador": locador, "provedor": provedor, "category": category, "tag": tag}


def migrate(clean_schema=None):
    config = alembic_config()
    command.upgrade(config, "0042")
    with engine.begin() as conn:
        world, ids = build_world(conn)
    command.upgrade(config, "head")
    return world, ids


def test_a_reminder_that_is_up_to_date_starts_at_the_next_due_date(clean_schema):
    _, ids = migrate()
    with engine.connect() as conn:
        auto = recurrences_by_name(conn, auto=True)
    aluguel = auto["Aluguel"]
    assert aluguel["first_date"] == days(7) and aluguel["next_date"] == days(7)
    assert aluguel["active"] is True and aluguel["max_occurrences"] is None and aluguel["end_date"] is None
    [split] = aluguel["template"]["splits"]
    # Conta, contraparte, categoria, tag e valor vem do ultimo pagamento (o de hoje, de 1880,00)
    assert split["type"] == "withdrawal"
    assert split["account_id"] == ids["itau"] and split["counterparty_account_id"] == ids["locador"]
    assert split["amount"] == "1880.00" and split["currency_code"] == "BRL"
    assert split["category_id"] == ids["category"] and split["tag_ids"] == [ids["tag"]]
    assert split["is_paid"] is False and split["bill_id"] is None and split["description"] == "Aluguel"


def test_an_overdue_reminder_starts_at_its_oldest_unpaid_due_date(clean_schema):
    migrate()
    with engine.connect() as conn:
        auto = recurrences_by_name(conn, auto=True)
    # Pagou so o vencimento de -21: os de -14, -7 e hoje ficaram sem pagar e o mais antigo e o de -14
    assert auto["Internet"]["first_date"] == days(-14)
    [split] = auto["Internet"]["template"]["splits"]
    assert split["account_id"] and split["amount"] == "120.00"


def test_a_reminder_without_history_learns_the_usual_account_and_uses_the_top_of_the_range(clean_schema):
    _, ids = migrate()
    with engine.connect() as conn:
        auto = recurrences_by_name(conn, auto=True)
    cinema = auto["Cinema"]
    [split] = cinema["template"]["splits"]
    assert split["account_id"] == ids["itau"]
    assert split["amount"] == "60.00" and split["counterparty_name"] == "Cinema"
    assert "counterparty_account_id" not in split
    assert cinema["first_date"] == days(-14)


def test_end_rules_are_carried_over_and_a_finished_reminder_is_only_archived(clean_schema):
    migrate()
    with engine.connect() as conn:
        auto = recurrences_by_name(conn, auto=True)
        old = recurrences_by_name(conn, auto=False)
    assert auto["Curso"]["end_date"] == days(3) and auto["Curso"]["max_occurrences"] is None
    # Dez ocorrencias, as duas primeiras ja pagas: a nova comeca na terceira (hoje) e sobram oito
    assert auto["Plano"]["first_date"] == days(0) and auto["Plano"]["max_occurrences"] == 8
    # Seguro tinha 3 vencimentos e todos passaram: nada a criar
    assert "Seguro" not in auto
    assert old["Seguro"]["active"] is False


def test_a_deposit_reminder_uses_the_destination_as_the_account(clean_schema):
    _, ids = migrate()
    with engine.connect() as conn:
        auto = recurrences_by_name(conn, auto=True)
    [split] = auto["Bonus"]["template"]["splits"]
    assert split["type"] == "deposit" and split["account_id"] == ids["itau"] and split["amount"] == "550.00"


def test_old_reminders_are_archived_not_deleted_and_their_history_stays(clean_schema):
    migrate()
    with engine.connect() as conn:
        old = recurrences_by_name(conn, auto=False)
        linked = conn.execute(text("SELECT count(*) FROM transaction_splits WHERE bill_id IS NOT NULL")).scalar()
    for name in ("Aluguel", "Internet", "Cinema", "Seguro", "Curso", "Plano", "Bonus"):
        assert old[name]["active"] is False, name
    assert linked == 4 + 1 + 3 + 2 + 1  # os lancamentos continuam ligados aos lembretes arquivados


def test_what_cannot_be_converted_or_was_already_archived_is_left_alone(clean_schema):
    migrate()
    with engine.connect() as conn:
        auto = recurrences_by_name(conn, auto=True)
        old = recurrences_by_name(conn, auto=False)
    # Sem nenhum pagamento do usuario para aprender a conta: continua como lembrete ativo
    assert "Orfao" not in auto and old["Orfao"]["active"] is True
    # Ja arquivado pelo usuario: nao vira nada
    assert "Velho" not in auto and old["Velho"]["active"] is False


def test_every_template_is_a_valid_transaction_for_the_current_schema(clean_schema):
    migrate()
    with engine.connect() as conn:
        auto = recurrences_by_name(conn, auto=True)
    assert auto
    for name, row in auto.items():
        template = TransactionCreate.model_validate(row["template"])
        assert template.splits[0].is_paid is False, name


def test_the_engine_creates_the_pending_transactions_including_the_overdue_ones(clean_schema):
    migrate()
    with SessionLocal() as db:
        created = recurrence_service.run_all(db, TODAY)
        db.commit()
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT s.description, s.date, s.is_paid, s.amount FROM transaction_splits s "
                "JOIN transactions t ON t.id = s.transaction_id WHERE t.recurrence_id IS NOT NULL ORDER BY s.description, s.date"
            )
        ).all()
        errors = conn.execute(text("SELECT name, last_error FROM recurrences WHERE auto_create AND last_error IS NOT NULL")).all()
    assert errors == []
    assert created == len(rows)
    by_name: dict[str, list] = {}
    for description, day, paid, amount in rows:
        by_name.setdefault(description, []).append((day, paid))
    # Internet: os tres vencimentos sem pagar (-14, -7 e hoje), todos pendentes
    assert by_name["Internet"] == [(days(-14), False), (days(-7), False), (days(0), False)]
    # Aluguel: o proximo e daqui a 7 dias, nada ainda
    assert "Aluguel" not in by_name
    assert all(not paid for entries in by_name.values() for _, paid in entries)

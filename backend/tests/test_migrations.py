import uuid

from alembic import command
from sqlalchemy import text

from app.core.database import engine
from tests.conftest import alembic_config


def test_upgrade_head_on_empty_database(clean_schema):
    command.upgrade(alembic_config(), "head")
    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    assert version == "0043"


def test_downgrade_to_base_and_upgrade_again(clean_schema):
    config = alembic_config()
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")


def test_migration_0003_seeds_currencies_and_keeps_existing_users(clean_schema):
    """Quem ja tinha conta antes das moedas passa a ter BRL como padrao, sem erro de chave."""
    config = alembic_config()
    command.upgrade(config, "0002")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('11111111-1111-4111-8111-111111111111', 'Ana', 'ana@example.com', 'x')"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        default = conn.execute(text("SELECT default_currency FROM users")).scalar()
        codes = {row[0] for row in conn.execute(text("SELECT code FROM currencies"))}
        jpy_places = conn.execute(text("SELECT decimal_places FROM currencies WHERE code = 'JPY'")).scalar()
    assert default == "BRL"
    assert {"BRL", "USD", "EUR"} <= codes
    assert jpy_places == 0


def test_migration_0030_turns_envelopes_into_budgets_with_carry_over(clean_schema):
    """Quem tinha um envelope de verdade (sem limite, so a distribuicao do mes) nao pode travar o
    deploy nem perder o valor: o limite novo vem da ultima distribuicao."""
    config = alembic_config()
    command.upgrade(config, "0029")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('22222222-2222-4222-8222-222222222222', 'Ana', 'ana2@example.com', 'x')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO budgets (id, user_id, name, currency_code, amount, period, mode, active) "
                "VALUES ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', "
                "'Moradia fixa', 'BRL', NULL, 'monthly', 'envelope', true)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO budget_allocations (id, user_id, budget_id, month, amount) VALUES "
                "('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', "
                "'33333333-3333-4333-8333-333333333333', '2026-08-01', 300.00), "
                "('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', "
                "'33333333-3333-4333-8333-333333333333', '2026-09-01', 1900.00)"
            )
        )
        # Envelope que nunca recebeu distribuicao nenhuma: nao pode travar por falta de linha
        conn.execute(
            text(
                "INSERT INTO budgets (id, user_id, name, currency_code, amount, period, mode, active) "
                "VALUES ('66666666-6666-4666-8666-666666666666', '22222222-2222-4222-8222-222222222222', "
                "'Reserva', 'BRL', NULL, 'monthly', 'envelope', true)"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        rows = {
            row.name: row
            for row in conn.execute(
                text("SELECT name, amount, carry_over, period FROM budgets WHERE user_id = '22222222-2222-4222-8222-222222222222'")
            )
        }
    # A ultima distribuicao (setembro), nao a primeira
    assert (rows["Moradia fixa"].amount, rows["Moradia fixa"].carry_over, rows["Moradia fixa"].period) == (1900, True, "monthly")
    assert rows["Reserva"].carry_over is True
    assert rows["Reserva"].amount > 0


def test_migration_0031_turns_bills_into_reminder_mode_recurrences(clean_schema):
    """Quem tinha uma conta a pagar de verdade, ja com um lancamento ligado a ela (bill_id), nao
    pode perder a ligacao nem travar o deploy: o id continua o mesmo, so muda de tabela."""
    config = alembic_config()
    command.upgrade(config, "0030")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('77777777-7777-4777-8777-777777777777', 'Ana', 'ana3@example.com', 'x')"
            )
        )
        conn.execute(
            text("INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ('BRL', 'Real', 'R$', 2) ON CONFLICT DO NOTHING")
        )
        conn.execute(
            text(
                "INSERT INTO bills (id, user_id, name, currency_code, amount_min, amount_max, match_text, first_due_date, frequency, active) "
                "VALUES ('88888888-8888-4888-8888-888888888888', '77777777-7777-4777-8777-777777777777', "
                "'Aluguel', 'BRL', 1500.00, 1500.00, 'aluguel', '2026-01-05', 'monthly', true)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO accounts (id, user_id, name, type, currency_code) VALUES "
                "('99999999-9999-4999-8999-999999999999', '77777777-7777-4777-8777-777777777777', 'Conta', 'asset', 'BRL'), "
                "('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777', 'Aluguel (despesa)', 'expense', 'BRL')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO transactions (id, user_id, title) VALUES "
                "('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '77777777-7777-4777-8777-777777777777', NULL)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO transaction_splits (id, transaction_id, user_id, type, date, description, "
                "source_account_id, destination_account_id, amount, currency_code, bill_id) VALUES "
                "('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', "
                "'77777777-7777-4777-8777-777777777777', 'withdrawal', '2026-01-05', 'Aluguel de janeiro', "
                "'99999999-9999-4999-8999-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1500.00, 'BRL', "
                "'88888888-8888-4888-8888-888888888888')"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT name, auto_create, template, amount_min, amount_max, currency_code "
                "FROM recurrences WHERE id = '88888888-8888-4888-8888-888888888888'"
            )
        ).one()
        linked_bill_id = conn.execute(
            text("SELECT bill_id FROM transaction_splits WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'")
        ).scalar()
        bills_table_exists = conn.execute(
            text("SELECT to_regclass('bills')")
        ).scalar()
    assert (row.name, row.auto_create, row.template, row.amount_min, row.amount_max, row.currency_code) == (
        "Aluguel", False, None, 1500, 1500, "BRL",
    )
    assert linked_bill_id == uuid.UUID("88888888-8888-4888-8888-888888888888")
    assert bills_table_exists is None


def test_migration_0032_backfills_type_on_reminders_and_leaves_automatic_ones_null(clean_schema):
    """Quem ja tinha um lembrete de verdade (so despesa, antes desta mudanca) nao pode ficar sem
    tipo; quem tinha uma recorrente automatica nao pode ganhar um tipo que nao pediu."""
    config = alembic_config()
    command.upgrade(config, "0031")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Ana', 'ana4@example.com', 'x')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ('BRL', 'Real', 'R$', 2) ON CONFLICT DO NOTHING"
            )
        )
        # Lembrete ja existente (modo antigo, sem tipo)
        conn.execute(
            text(
                "INSERT INTO recurrences (id, user_id, name, frequency, first_date, active, auto_create, "
                "next_index, currency_code, amount_min, amount_max, match_text) VALUES "
                "('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', "
                "'Aluguel', 'monthly', '2026-01-05', true, false, 0, 'BRL', 1500.00, 1500.00, 'aluguel')"
            )
        )
        # Recorrente automatica ja existente (so tem template, nunca teve tipo)
        conn.execute(
            text(
                "INSERT INTO recurrences (id, user_id, name, frequency, first_date, active, auto_create, "
                "template, next_index) VALUES "
                "('ffffffff-ffff-4fff-8fff-ffffffffffff', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', "
                "'Salario', 'monthly', '2026-01-05', true, true, '{}', 0)"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        rows = {
            row.id: row.type
            for row in conn.execute(text("SELECT id, type FROM recurrences WHERE user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'"))
        }
    assert rows[uuid.UUID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")] == "withdrawal"
    assert rows[uuid.UUID("ffffffff-ffff-4fff-8fff-ffffffffffff")] is None


def test_migration_0035_marks_existing_transactions_as_paid_and_not_ignored(clean_schema):
    """Quem ja tinha lancamentos antes das colunas nao pode ver o saldo mudar: tudo o que existia
    passa a ser pago e nao ignorado, sem UPDATE linha a linha."""
    config = alembic_config()
    command.upgrade(config, "0034")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('99999999-9999-4999-8999-999999999999', 'Ana', 'ana5@example.com', 'x')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ('BRL', 'Real', 'R$', 2) ON CONFLICT DO NOTHING"
            )
        )
        for account_id, name, kind in [
            ("a1111111-1111-4111-8111-111111111111", "Itau", "asset"),
            ("a2222222-2222-4222-8222-222222222222", "Mercado", "expense"),
        ]:
            conn.execute(
                text(
                    "INSERT INTO accounts (id, user_id, name, type, currency_code) VALUES "
                    f"('{account_id}', '99999999-9999-4999-8999-999999999999', '{name}', '{kind}', 'BRL')"
                )
            )
        conn.execute(
            text(
                "INSERT INTO transactions (id, user_id) VALUES "
                "('b1111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO transaction_splits (id, transaction_id, user_id, type, date, description, "
                "source_account_id, destination_account_id, amount, currency_code) VALUES "
                "('c1111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111', "
                "'99999999-9999-4999-8999-999999999999', 'withdrawal', '2026-03-10', 'Compra', "
                "'a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 12.50, 'BRL')"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        row = conn.execute(text("SELECT is_paid, ignored FROM transaction_splits")).one()
    assert row.is_paid is True
    assert row.ignored is False


def test_migration_0040_keeps_old_budgets_without_dates_alert_or_categories(clean_schema):
    """Orcamento que ja existia continua como estava (semanal, mensal ou anual) e a migracao nao trava por causa das
    regras novas do periodo personalizado."""
    config = alembic_config()
    command.upgrade(config, "0039")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('77777777-7777-4777-8777-777777777777', 'Ana', 'ana3@example.com', 'x')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO budgets (id, user_id, name, currency_code, amount, period, carry_over, active) VALUES "
                "('88888888-8888-4888-8888-888888888888', '77777777-7777-4777-8777-777777777777', "
                "'Mercado', 'BRL', 800.00, 'monthly', true, true), "
                "('99999999-9999-4999-8999-999999999999', '77777777-7777-4777-8777-777777777777', "
                "'Feira', 'BRL', 100.00, 'weekly', false, true)"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        rows = conn.execute(text("SELECT name, period, carry_over, start_date, end_date, alert FROM budgets ORDER BY name")).all()
        categories = conn.execute(text("SELECT count(*) FROM budget_categories")).scalar()
        # As regras novas valem para o que entrar depois: personalizado sem datas e recusado
        refused = False
        try:
            with conn.begin():
                conn.execute(
                    text(
                        "INSERT INTO budgets (id, user_id, name, currency_code, amount, period) VALUES "
                        "('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777', "
                        "'Sem datas', 'BRL', 10, 'custom')"
                    )
                )
        except Exception:
            refused = True
    assert [(r.name, r.period, r.carry_over, r.start_date, r.end_date, r.alert) for r in rows] == [
        ("Feira", "weekly", False, None, None, False),
        ("Mercado", "monthly", True, None, None, False),
    ]
    assert categories == 0
    assert refused


def test_models_match_migrations(clean_schema):
    """Se alguem mudar um model e esquecer a migration, este teste acusa."""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from app.core.database import Base

    command.upgrade(alembic_config(), "head")
    with engine.connect() as conn:
        context = MigrationContext.configure(conn, opts={"compare_type": True})
        diff = compare_metadata(context, Base.metadata)
    assert diff == []

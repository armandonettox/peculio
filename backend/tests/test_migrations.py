from alembic import command
from sqlalchemy import text

from app.core.database import engine
from tests.conftest import alembic_config


def test_upgrade_head_on_empty_database(clean_schema):
    command.upgrade(alembic_config(), "head")
    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    assert version == "0030"


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

from alembic import command
from sqlalchemy import text

from app.core.database import engine
from tests.conftest import alembic_config


def test_upgrade_head_on_empty_database(clean_schema):
    command.upgrade(alembic_config(), "head")
    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    assert version == "0016"


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

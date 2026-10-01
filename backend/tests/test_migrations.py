from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.core.database import engine

BACKEND_DIR = Path(__file__).resolve().parents[1]


def alembic_config() -> Config:
    return Config(str(BACKEND_DIR / "alembic.ini"))


def test_upgrade_head_on_empty_database(clean_schema):
    command.upgrade(alembic_config(), "head")
    with engine.connect() as conn:
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    assert version == "0001"


def test_downgrade_to_base_and_upgrade_again(clean_schema):
    config = alembic_config()
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")

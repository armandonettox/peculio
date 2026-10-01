import os

# Precisa vir antes de importar o app, porque as configuracoes sao lidas na importacao.
# O banco de teste sobe com: docker compose -f docker-compose.test.yml up -d
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://finance:finance@localhost:5433/finance_test",
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["ENVIRONMENT"] = "development"

import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.database import engine  # noqa: E402


@pytest.fixture
def clean_schema():
    """Deixa o banco de teste vazio antes e depois do teste."""

    def reset() -> None:
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))

    reset()
    yield
    reset()

import os

# Precisa vir antes de importar o app, porque as configuracoes sao lidas na importacao.
# O banco de teste sobe com: docker compose -f docker-compose.test.yml up -d
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://finance:finance@localhost:5433/finance_test",
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["ENVIRONMENT"] = "development"
# Chave de teste com tamanho adequado para HMAC-SHA256 (evita aviso do PyJWT)
os.environ["JWT_SECRET"] = "chave-de-teste-com-mais-de-32-caracteres-ok"

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.database import SessionLocal, engine  # noqa: E402
from app.core.rate_limit import limiter  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]


def alembic_config() -> Config:
    return Config(str(BACKEND_DIR / "alembic.ini"))


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


@pytest.fixture
def migrated_db(clean_schema):
    """Banco limpo com todas as migrations aplicadas, o mesmo caminho da producao."""
    command.upgrade(alembic_config(), "head")


@pytest.fixture(autouse=True)
def disable_rate_limit():
    # Os testes registram e logam varias vezes; o limite so e ligado nos testes de rate limit
    limiter.enabled = False
    limiter.reset()
    yield
    limiter.enabled = False


@pytest.fixture
def client(migrated_db):
    return TestClient(app)


@pytest.fixture
def db_session(migrated_db):
    session = SessionLocal()
    yield session
    session.close()


DEFAULT_PASSWORD = "SenhaForte123"


def register(client, email="admin@example.com", password=DEFAULT_PASSWORD, name="Admin", **extra):
    return client.post(
        "/api/v1/auth/register",
        json={"name": name, "email": email, "password": password, **extra},
    )


def login_token(client, email="admin@example.com", password=DEFAULT_PASSWORD) -> str:
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    return resp.json()["access_token"]


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def make_user(db_session, email="user@example.com", password=DEFAULT_PASSWORD, is_admin=False) -> User:
    """Cria usuario direto no banco, sem passar pelo fluxo de convite."""
    user = User(name="Teste", email=email, hashed_password=hash_password(password), is_admin=is_admin)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user

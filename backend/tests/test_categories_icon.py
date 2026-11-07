import pytest
from alembic import command
from sqlalchemy import text

from app.core.database import engine
from tests.conftest import alembic_config, auth_headers, register

URL = "/api/v1/categories"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def create(client, headers, **body):
    return client.post(URL, json={"name": "Mercado", "kind": "expense", **body}, headers=headers)


def test_category_has_no_icon_by_default(client, headers):
    assert create(client, headers).json()["icon"] is None


def test_icon_is_saved_and_returned(client, headers):
    assert create(client, headers, icon="shopping-cart").json()["icon"] == "shopping-cart"


@pytest.mark.parametrize("bad", ["", "Shopping-Cart", "carrinho", "<script>", "house ", "x" * 40])
def test_unknown_icons_are_rejected(client, headers, bad):
    resp = create(client, headers, icon=bad)
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


def test_change_the_icon_keeps_the_rest(client, headers):
    item_id = create(client, headers, color="#00A878", icon="house").json()["id"]
    body = client.patch(f"{URL}/{item_id}", json={"icon": "car"}, headers=headers).json()
    assert (body["icon"], body["color"], body["name"]) == ("car", "#00A878", "Mercado")


def test_null_clears_the_icon(client, headers):
    item_id = create(client, headers, icon="house").json()["id"]
    body = client.patch(f"{URL}/{item_id}", json={"icon": None}, headers=headers).json()
    assert body["icon"] is None


def test_renaming_does_not_touch_the_icon(client, headers):
    item_id = create(client, headers, icon="house").json()["id"]
    body = client.patch(f"{URL}/{item_id}", json={"name": "Casa"}, headers=headers).json()
    assert (body["name"], body["icon"]) == ("Casa", "house")


def test_icon_shows_in_the_listing(client, headers):
    create(client, headers, icon="pizza")
    [item] = client.get(URL, headers=headers).json()["items"]
    assert item["icon"] == "pizza"


def test_migration_0036_keeps_existing_categories_without_icon(clean_schema):
    """Quem ja tinha categorias antes da coluna nao perde nada: todas ficam sem icone."""
    config = alembic_config()
    command.upgrade(config, "0035")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('abababab-abab-4bab-8bab-abababababab', 'Ana', 'ana6@example.com', 'x')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO categories (id, user_id, name, kind, color) VALUES "
                "('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', 'abababab-abab-4bab-8bab-abababababab', 'Mercado', 'expense', '#00A878')"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        row = conn.execute(text("SELECT name, color, icon FROM categories")).one()
    assert (row.name, row.color, row.icon) == ("Mercado", "#00A878", None)

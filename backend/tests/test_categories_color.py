import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models.category import Category
from tests.conftest import auth_headers, register

URL = "/api/v1/categories"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def create(client, headers, **body):
    return client.post(URL, json={"name": "Mercado", **body}, headers=headers)


def test_category_has_no_color_by_default(client, headers):
    assert create(client, headers).json()["color"] is None


def test_color_is_saved_and_returned_in_uppercase(client, headers):
    assert create(client, headers, color="#1e3a6b").json()["color"] == "#1E3A6B"


@pytest.mark.parametrize("bad", ["red", "#12345", "#1234567", "#GGGGGG", "1E3A6B", "#1E3A6", "", "rgb(1,2,3)"])
def test_invalid_colors_are_rejected(client, headers, bad):
    resp = create(client, headers, color=bad)
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


def test_change_the_color(client, headers):
    item_id = create(client, headers, color="#00A878").json()["id"]
    body = client.patch(f"{URL}/{item_id}", json={"color": "#01603b"}, headers=headers).json()
    assert body["color"] == "#01603B"
    assert body["name"] == "Mercado"


def test_null_clears_the_color(client, headers):
    item_id = create(client, headers, color="#00A878").json()["id"]
    body = client.patch(f"{URL}/{item_id}", json={"color": None}, headers=headers).json()
    assert body["color"] is None


def test_renaming_does_not_touch_the_color(client, headers):
    item_id = create(client, headers, color="#00A878").json()["id"]
    body = client.patch(f"{URL}/{item_id}", json={"name": "Feira"}, headers=headers).json()
    assert body["color"] == "#00A878"
    assert body["name"] == "Feira"


def test_invalid_color_on_update_is_rejected_and_keeps_the_old_one(client, headers):
    item_id = create(client, headers, color="#00A878").json()["id"]
    assert client.patch(f"{URL}/{item_id}", json={"color": "azul"}, headers=headers).status_code == 422
    assert client.get(f"{URL}/{item_id}", headers=headers).json()["color"] == "#00A878"


def test_database_refuses_an_invalid_color(client, headers, db_session):
    create(client, headers)
    owner = db_session.query(Category).one().user_id
    with pytest.raises(IntegrityError):
        db_session.execute(
            text("INSERT INTO categories (id, user_id, name, color) VALUES (gen_random_uuid(), :u, 'X', 'verde')"),
            {"u": owner},
        )
    db_session.rollback()

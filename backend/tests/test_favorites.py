import pytest
from alembic import command
from sqlalchemy import text

from app.core.database import engine
from tests.conftest import alembic_config, auth_headers, make_user, register

URL = "/api/v1/favorites"
SUGGEST = f"{URL}/suggestions"
TX = "/api/v1/transactions"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def account(client, headers, name="Itau", **extra):
    body = {"name": name, "type": "asset", "currency_code": "BRL", "opening_balance": "1000.00", **extra}
    return client.post("/api/v1/accounts", json=body, headers=headers).json()["id"]


def category(client, headers, name="Mercado", kind="expense"):
    return client.post("/api/v1/categories", json={"name": name, "kind": kind}, headers=headers).json()["id"]


def favorite(client, headers, **body):
    return client.post(URL, json={"type": "withdrawal", "description": "Padaria", **body}, headers=headers)


def spend(client, headers, account_id, description, kind="withdrawal", on="2026-03-10", **extra):
    split = {
        "type": kind,
        "date": on,
        "description": description,
        "amount": "10.00",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Local",
        **extra,
    }
    resp = client.post(TX, json={"splits": [split]}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def suggestions(client, headers, **params):
    resp = client.get(SUGGEST, params={"type": "withdrawal", **params}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def other_headers(client, db_session):
    make_user(db_session, email="outra@example.com")
    return auth_headers(client, email="outra@example.com")


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={}).status_code == 401
    assert client.get(SUGGEST, params={"type": "withdrawal"}).status_code == 401


# ---------- Favoritos ----------


def test_saves_a_favorite_with_category_and_account(client, headers):
    acc, cat = account(client, headers), category(client, headers)
    resp = favorite(client, headers, category_id=cat, account_id=acc)
    assert resp.status_code == 201
    body = resp.json()
    assert (body["type"], body["description"], body["category_id"], body["account_id"]) == ("withdrawal", "Padaria", cat, acc)
    assert "amount" not in body


def test_description_is_trimmed(client, headers):
    assert favorite(client, headers, description="  Padaria  ").json()["description"] == "Padaria"


def test_same_description_updates_instead_of_duplicating_ignoring_case(client, headers):
    acc, cat = account(client, headers), category(client, headers)
    first = favorite(client, headers, description="Padaria").json()
    resp = favorite(client, headers, description="PADARIA", category_id=cat, account_id=acc)
    assert resp.status_code == 200
    assert resp.json()["id"] == first["id"]
    assert resp.json()["category_id"] == cat
    assert len(client.get(URL, headers=headers).json()) == 1


def test_same_description_can_be_favorite_in_both_directions(client, headers):
    assert favorite(client, headers, type="withdrawal").status_code == 201
    assert favorite(client, headers, type="deposit").status_code == 201
    assert len(client.get(URL, headers=headers).json()) == 2


@pytest.mark.parametrize(
    "body",
    [{"description": ""}, {"description": "   "}, {"type": "transfer"}, {"type": "x"}, {"description": "x" * 256}],
)
def test_invalid_bodies_are_rejected(client, headers, body):
    resp = favorite(client, headers, **body)
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


def test_category_of_the_wrong_direction_is_refused(client, headers):
    income = category(client, headers, name="Salario", kind="revenue")
    resp = favorite(client, headers, type="withdrawal", category_id=income)
    assert resp.status_code == 400
    assert resp.json()["code"] == "category_kind_mismatch"


def test_category_and_account_of_another_user_are_404(client, headers, db_session):
    other = other_headers(client, db_session)
    foreign_cat, foreign_acc = category(client, other, name="Dela"), account(client, other, name="Dela")
    assert favorite(client, headers, category_id=foreign_cat).status_code == 404
    assert favorite(client, headers, account_id=foreign_acc).status_code == 404


def test_list_filters_by_type_and_orders_by_name(client, headers):
    favorite(client, headers, description="banana")
    favorite(client, headers, description="Abacate")
    favorite(client, headers, type="deposit", description="Salario")
    names = [item["description"] for item in client.get(URL, params={"type": "withdrawal"}, headers=headers).json()]
    assert names == ["Abacate", "banana"]
    assert len(client.get(URL, headers=headers).json()) == 3


def test_list_never_shows_another_users_favorites(client, headers, db_session):
    favorite(client, headers)
    other = other_headers(client, db_session)
    assert client.get(URL, headers=other).json() == []


def test_delete_a_favorite(client, headers):
    fav_id = favorite(client, headers).json()["id"]
    assert client.delete(f"{URL}/{fav_id}", headers=headers).status_code == 204
    assert client.get(URL, headers=headers).json() == []


def test_delete_of_someone_elses_favorite_is_404(client, headers, db_session):
    fav_id = favorite(client, headers).json()["id"]
    other = other_headers(client, db_session)
    assert client.delete(f"{URL}/{fav_id}", headers=other).status_code == 404
    assert len(client.get(URL, headers=headers).json()) == 1


def test_deleting_the_category_keeps_the_favorite_without_it(client, headers):
    cat = category(client, headers)
    favorite(client, headers, category_id=cat)
    assert client.delete(f"/api/v1/categories/{cat}", headers=headers).status_code == 204
    [item] = client.get(URL, headers=headers).json()
    assert item["category_id"] is None


# ---------- Sugestoes ----------


def test_suggestions_put_favorites_first_then_history(client, headers):
    acc, cat = account(client, headers), category(client, headers)
    spend(client, headers, acc, "Cafe da manha", category_id=cat)
    favorite(client, headers, description="Cafeteria", category_id=cat, account_id=acc)
    items = suggestions(client, headers, q="caf")
    assert [i["description"] for i in items] == ["Cafeteria", "Cafe da manha"]
    assert items[0]["favorite_id"] is not None and items[1]["favorite_id"] is None


def test_history_suggestion_carries_category_and_account_but_no_amount(client, headers):
    acc, cat = account(client, headers), category(client, headers)
    spend(client, headers, acc, "Feira", category_id=cat)
    [item] = suggestions(client, headers, q="fei")
    assert (item["category_id"], item["account_id"]) == (cat, acc)
    assert set(item) == {"description", "category_id", "account_id", "favorite_id"}


def test_history_has_each_description_once_with_the_most_recent_data(client, headers):
    acc = account(client, headers)
    old, new = category(client, headers, name="Antiga"), category(client, headers, name="Nova")
    spend(client, headers, acc, "Feira", on="2026-01-05", category_id=old)
    spend(client, headers, acc, "feira", on="2026-03-05", category_id=new)
    items = suggestions(client, headers, q="feira")
    assert len(items) == 1
    assert items[0]["category_id"] == new


def test_a_favorite_hides_the_same_description_from_history(client, headers):
    acc = account(client, headers)
    spend(client, headers, acc, "Padaria")
    favorite(client, headers, description="padaria")
    items = suggestions(client, headers, q="padaria")
    assert len(items) == 1 and items[0]["favorite_id"] is not None


def test_suggestions_are_per_direction(client, headers):
    acc = account(client, headers)
    spend(client, headers, acc, "Freela", kind="deposit")
    spend(client, headers, acc, "Mercado", kind="withdrawal")
    assert [i["description"] for i in suggestions(client, headers, type="deposit")] == ["Freela"]
    assert [i["description"] for i in suggestions(client, headers, type="withdrawal")] == ["Mercado"]


def test_deposit_suggestion_uses_the_account_that_receives(client, headers):
    acc = account(client, headers)
    spend(client, headers, acc, "Freela", kind="deposit")
    [item] = suggestions(client, headers, type="deposit")
    assert item["account_id"] == acc


def test_transfers_are_not_suggested(client, headers):
    a, b = account(client, headers, name="A"), account(client, headers, name="B")
    body = {
        "type": "transfer",
        "date": "2026-03-10",
        "description": "Passei",
        "amount": "5.00",
        "currency_code": "BRL",
        "account_id": a,
        "counterparty_account_id": b,
    }
    assert client.post(TX, json={"splits": [body]}, headers=headers).status_code == 201
    assert suggestions(client, headers, type="withdrawal") == []
    assert suggestions(client, headers, type="deposit") == []


def test_without_query_returns_the_latest_up_to_the_limit(client, headers):
    acc = account(client, headers)
    for day, name in enumerate(["A", "B", "C"], start=1):
        spend(client, headers, acc, name, on=f"2026-03-0{day}")
    assert [i["description"] for i in suggestions(client, headers, limit=2)] == ["C", "B"]


def test_limit_is_bounded(client, headers):
    assert client.get(SUGGEST, params={"type": "withdrawal", "limit": 0}, headers=headers).status_code == 422
    assert client.get(SUGGEST, params={"type": "withdrawal", "limit": 21}, headers=headers).status_code == 422


def test_percent_and_underscore_in_the_query_are_plain_text(client, headers):
    acc = account(client, headers)
    spend(client, headers, acc, "Desconto 10% off")
    spend(client, headers, acc, "Outra coisa")
    assert [i["description"] for i in suggestions(client, headers, q="10%")] == ["Desconto 10% off"]
    assert suggestions(client, headers, q="_") == []


def test_other_users_data_is_never_suggested(client, headers, db_session):
    other = other_headers(client, db_session)
    spend(client, other, account(client, other, name="Dela"), "Segredo")
    favorite(client, other, description="Segredo favorito")
    assert suggestions(client, headers, q="segredo") == []


def test_invalid_type_for_suggestions_is_422(client, headers):
    assert client.get(SUGGEST, params={"type": "transfer"}, headers=headers).status_code == 422


# ---------- Migration ----------


def test_migration_0037_creates_favorites_and_keeps_existing_data(clean_schema):
    config = alembic_config()
    command.upgrade(config, "0036")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('efefefef-efef-4fef-8fef-efefefefefef', 'Ana', 'ana7@example.com', 'x')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO categories (id, user_id, name, kind) VALUES "
                "('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'efefefef-efef-4fef-8fef-efefefefefef', 'Mercado', 'expense')"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        name = conn.execute(text("SELECT name FROM categories")).scalar()
        favorites = conn.execute(text("SELECT count(*) FROM favorites")).scalar()
    assert (name, favorites) == ("Mercado", 0)

"""Categorias e tags se comportam igual (nome unico por usuario, isolamento, busca):
os testes comuns rodam para as duas."""

import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.category import Category
from app.models.tag import Tag
from tests.conftest import auth_headers, make_user, register

RESOURCES = {
    "categories": {
        "url": "/api/v1/categories",
        "model": Category,
        "taken": "category_name_taken",
        "missing": "category_not_found",
        "max_name": 100,
    },
    "tags": {
        "url": "/api/v1/tags",
        "model": Tag,
        "taken": "tag_name_taken",
        "missing": "tag_not_found",
        "max_name": 50,
    },
}


@pytest.fixture(params=list(RESOURCES))
def res(request):
    return RESOURCES[request.param]


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def other_headers(client, db_session, email="outra@example.com"):
    make_user(db_session, email=email)
    return auth_headers(client, email=email)


def create(client, res, headers, name="Mercado", **extra):
    return client.post(res["url"], json={"name": name, **extra}, headers=headers)


# ---------- Criar ----------


def test_requires_login(client, res):
    assert client.get(res["url"]).status_code == 401
    assert client.post(res["url"], json={"name": "x"}).status_code == 401


def test_create_returns_the_item(client, res, headers):
    resp = create(client, res, headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Mercado"
    assert uuid.UUID(body["id"])
    assert "created_at" in body
    assert "user_id" not in body


def test_name_is_trimmed(client, res, headers):
    assert create(client, res, headers, name="  Mercado  ").json()["name"] == "Mercado"


@pytest.mark.parametrize("bad", ["", "   "])
def test_empty_name_is_rejected(client, res, headers, bad):
    resp = create(client, res, headers, name=bad)
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


def test_name_length_limit(client, res, headers):
    assert create(client, res, headers, name="a" * res["max_name"]).status_code == 201
    assert create(client, res, headers, name="b" * (res["max_name"] + 1)).status_code == 422


def test_unknown_fields_are_rejected_instead_of_ignored(client, res, headers):
    assert create(client, res, headers, user_id=str(uuid.uuid4())).status_code == 422


def test_duplicate_name_is_rejected_ignoring_case(client, res, headers):
    assert create(client, res, headers, name="Mercado").status_code == 201
    for repeated in ("Mercado", "mercado", "MERCADO", " mercado "):
        resp = create(client, res, headers, name=repeated)
        assert resp.status_code == 409
        assert resp.json()["code"] == res["taken"]


def test_accents_make_names_different(client, res, headers):
    assert create(client, res, headers, name="Saude").status_code == 201
    assert create(client, res, headers, name="Saúde").status_code == 201


def test_two_users_can_have_the_same_name(client, res, headers, db_session):
    create(client, res, headers, name="Mercado")
    other = other_headers(client, db_session)
    assert create(client, res, other, name="Mercado").status_code == 201


def test_database_itself_refuses_duplicates_ignoring_case(client, res, headers, db_session):
    """A regra nao depende do codigo da API: o banco garante, mesmo com duas requisicoes juntas."""
    create(client, res, headers, name="Mercado")
    existing = db_session.query(res["model"]).one()
    db_session.add(res["model"](user_id=existing.user_id, name="MERCADO"))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_categories_and_tags_have_separate_namespaces(client, headers):
    assert create(client, RESOURCES["categories"], headers, name="Casa").status_code == 201
    assert create(client, RESOURCES["tags"], headers, name="Casa").status_code == 201


# ---------- Listar e buscar ----------


def test_list_is_sorted_ignoring_case_and_paginated(client, res, headers):
    for name in ["banco", "Casa", "Alfa", "delta"]:
        create(client, res, headers, name=name)
    page = client.get(f"{res['url']}?limit=2&offset=1", headers=headers).json()
    assert page["total"] == 4
    assert [i["name"] for i in page["items"]] == ["banco", "Casa"]


def test_empty_list(client, res, headers):
    assert client.get(res["url"], headers=headers).json() == {"items": [], "total": 0, "limit": 50, "offset": 0}


def test_search_by_name_ignores_case_and_matches_part_of_the_name(client, res, headers):
    for name in ["Mercado", "Supermercado", "Padaria", "Feira"]:
        create(client, res, headers, name=name)
    found = client.get(f"{res['url']}?q=MERCA", headers=headers).json()
    assert [i["name"] for i in found["items"]] == ["Mercado", "Supermercado"]
    assert found["total"] == 2


def test_search_without_results_and_blank_search(client, res, headers):
    create(client, res, headers, name="Mercado")
    assert client.get(f"{res['url']}?q=zzz", headers=headers).json()["items"] == []
    # Busca em branco traz tudo
    assert client.get(f"{res['url']}?q=%20%20", headers=headers).json()["total"] == 1


@pytest.mark.parametrize("wildcard", ["%", "_", "%%"])
def test_percent_and_underscore_in_the_search_are_plain_text(client, res, headers, wildcard):
    create(client, res, headers, name="Mercado")
    create(client, res, headers, name="100% algodao")
    found = client.get(res["url"], params={"q": wildcard}, headers=headers).json()
    if wildcard == "%":
        assert [i["name"] for i in found["items"]] == ["100% algodao"]
    else:
        assert found["items"] == []


def test_invalid_pagination_is_rejected(client, res, headers):
    assert client.get(f"{res['url']}?limit=0", headers=headers).status_code == 422
    assert client.get(f"{res['url']}?limit=201", headers=headers).status_code == 422


# ---------- Ler, editar e excluir ----------


def test_get_one(client, res, headers):
    item_id = create(client, res, headers).json()["id"]
    resp = client.get(f"{res['url']}/{item_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Mercado"


def test_unknown_item_is_404_for_get_patch_and_delete(client, res, headers):
    missing = uuid.uuid4()
    for call in (client.get, lambda u, **k: client.patch(u, json={"name": "x"}, **k), client.delete):
        resp = call(f"{res['url']}/{missing}", headers=headers)
        assert resp.status_code == 404
        assert resp.json()["code"] == res["missing"]


def test_rename(client, res, headers):
    item_id = create(client, res, headers).json()["id"]
    body = client.patch(f"{res['url']}/{item_id}", json={"name": "Supermercado"}, headers=headers).json()
    assert body["name"] == "Supermercado"
    assert client.get(f"{res['url']}/{item_id}", headers=headers).json()["name"] == "Supermercado"


def test_rename_to_a_taken_name_is_rejected(client, res, headers):
    create(client, res, headers, name="Feira")
    item_id = create(client, res, headers, name="Mercado").json()["id"]
    resp = client.patch(f"{res['url']}/{item_id}", json={"name": "feira"}, headers=headers)
    assert resp.status_code == 409
    assert resp.json()["code"] == res["taken"]
    # Continua com o nome antigo
    assert client.get(f"{res['url']}/{item_id}", headers=headers).json()["name"] == "Mercado"


def test_changing_only_the_case_of_its_own_name_is_allowed(client, res, headers):
    item_id = create(client, res, headers, name="mercado").json()["id"]
    resp = client.patch(f"{res['url']}/{item_id}", json={"name": "Mercado"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Mercado"


def test_patch_cannot_change_the_owner(client, res, headers):
    item_id = create(client, res, headers).json()["id"]
    resp = client.patch(f"{res['url']}/{item_id}", json={"user_id": str(uuid.uuid4())}, headers=headers)
    assert resp.status_code == 422


def test_empty_patch_changes_nothing(client, res, headers):
    item_id = create(client, res, headers).json()["id"]
    resp = client.patch(f"{res['url']}/{item_id}", json={}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Mercado"


def test_delete(client, res, headers):
    item_id = create(client, res, headers).json()["id"]
    assert client.delete(f"{res['url']}/{item_id}", headers=headers).status_code == 204
    assert client.get(f"{res['url']}/{item_id}", headers=headers).status_code == 404
    # O nome fica livre de novo
    assert create(client, res, headers).status_code == 201


# ---------- Isolamento entre usuarios ----------


def test_users_only_see_their_own_items(client, res, headers, db_session):
    create(client, res, headers, name="Da Ana")
    other = other_headers(client, db_session)
    create(client, res, other, name="Do Bruno")

    assert [i["name"] for i in client.get(res["url"], headers=headers).json()["items"]] == ["Da Ana"]
    assert [i["name"] for i in client.get(res["url"], headers=other).json()["items"]] == ["Do Bruno"]


def test_another_users_item_is_404_for_read_update_and_delete(client, res, headers, db_session):
    item_id = create(client, res, headers).json()["id"]
    other = other_headers(client, db_session)

    assert client.get(f"{res['url']}/{item_id}", headers=other).status_code == 404
    assert client.patch(f"{res['url']}/{item_id}", json={"name": "Roubado"}, headers=other).status_code == 404
    assert client.delete(f"{res['url']}/{item_id}", headers=other).status_code == 404
    assert client.get(f"{res['url']}/{item_id}", headers=headers).json()["name"] == "Mercado"


def test_search_never_crosses_users(client, res, headers, db_session):
    create(client, res, headers, name="Segredo da Ana")
    other = other_headers(client, db_session)
    assert client.get(f"{res['url']}?q=segredo", headers=other).json()["items"] == []


def test_deleting_the_user_removes_their_items(client, res, headers, db_session):
    create(client, res, headers)
    from app.models.user import User

    db_session.delete(db_session.query(User).one())
    db_session.commit()
    assert db_session.query(res["model"]).count() == 0

import pytest

from tests.conftest import bearer, login_token, register


@pytest.fixture
def admin_headers(client):
    register(client)
    return bearer(login_token(client))


def create_invites(client, headers, count: int) -> None:
    for i in range(count):
        resp = client.post("/api/v1/invites", json={"email": f"pessoa{i}@example.com"}, headers=headers)
        assert resp.status_code == 201


def list_invites(client, headers, query: str = ""):
    return client.get(f"/api/v1/invites{query}", headers=headers)


def test_default_page_shape(client, admin_headers):
    create_invites(client, admin_headers, 3)
    body = list_invites(client, admin_headers).json()
    assert set(body) == {"items", "total", "limit", "offset"}
    assert body["total"] == 3
    assert body["limit"] == 50
    assert body["offset"] == 0
    assert len(body["items"]) == 3


def test_limit_and_offset_slice_the_results(client, admin_headers):
    create_invites(client, admin_headers, 5)
    body = list_invites(client, admin_headers, "?limit=2&offset=2").json()
    assert body["total"] == 5
    assert len(body["items"]) == 2
    assert body["limit"] == 2
    assert body["offset"] == 2


def test_pages_do_not_repeat_or_skip_items(client, admin_headers):
    create_invites(client, admin_headers, 5)
    seen = []
    for offset in (0, 2, 4):
        page = list_invites(client, admin_headers, f"?limit=2&offset={offset}").json()
        seen += [item["id"] for item in page["items"]]
    assert len(seen) == 5
    assert len(set(seen)) == 5


def test_offset_past_the_end_returns_empty_items_with_total(client, admin_headers):
    create_invites(client, admin_headers, 2)
    body = list_invites(client, admin_headers, "?offset=10").json()
    assert body["items"] == []
    assert body["total"] == 2


def test_empty_list(client, admin_headers):
    body = list_invites(client, admin_headers).json()
    assert body == {"items": [], "total": 0, "limit": 50, "offset": 0}


@pytest.mark.parametrize("query", ["?limit=0", "?limit=201", "?offset=-1", "?limit=abc"])
def test_invalid_pagination_params_return_422(client, admin_headers, query):
    assert list_invites(client, admin_headers, query).status_code == 422


def test_max_limit_is_accepted(client, admin_headers):
    assert list_invites(client, admin_headers, "?limit=200").status_code == 200


def test_page_items_never_include_the_token(client, admin_headers):
    create_invites(client, admin_headers, 1)
    items = list_invites(client, admin_headers).json()["items"]
    assert "token" not in items[0]
    assert "token_hash" not in items[0]

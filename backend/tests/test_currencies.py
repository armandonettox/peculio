from tests.conftest import auth_headers, register


def test_currencies_require_login(client):
    assert client.get("/api/v1/currencies").status_code == 401


def test_lists_seeded_currencies(client):
    register(client)
    resp = client.get("/api/v1/currencies", headers=auth_headers(client))
    assert resp.status_code == 200
    by_code = {c["code"]: c for c in resp.json()}
    assert {"BRL", "USD", "EUR"} <= set(by_code)
    assert by_code["BRL"] == {"code": "BRL", "name": "Real brasileiro", "symbol": "R$", "decimal_places": 2}
    assert by_code["JPY"]["decimal_places"] == 0


def test_currencies_are_sorted_by_code(client):
    register(client)
    codes = [c["code"] for c in client.get("/api/v1/currencies", headers=auth_headers(client)).json()]
    assert codes == sorted(codes)


def test_new_users_default_to_brl(client):
    register(client)
    me = client.get("/api/v1/auth/me", headers=auth_headers(client)).json()
    assert me["default_currency"] == "BRL"

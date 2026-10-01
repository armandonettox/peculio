from tests.conftest import bearer, login_token, register


def get_status(client, headers=None):
    return client.get("/api/v1/auth/status", headers=headers or {})


def test_setup_required_on_empty_instance(client):
    resp = get_status(client)
    assert resp.status_code == 200
    assert resp.json() == {"setup_required": True}


def test_setup_not_required_after_first_user(client):
    register(client)
    assert get_status(client).json() == {"setup_required": False}


def test_status_is_public_and_needs_no_token(client):
    register(client)
    # Sem Authorization e com token lixo: responde igual
    assert get_status(client).status_code == 200
    assert get_status(client, bearer("lixo")).status_code == 200


def test_status_reveals_nothing_beyond_the_flag(client):
    register(client)
    assert set(get_status(client).json()) == {"setup_required"}


def test_status_flips_only_once_a_user_exists(client):
    assert get_status(client).json()["setup_required"] is True
    register(client)
    login_token(client)
    assert get_status(client).json()["setup_required"] is False

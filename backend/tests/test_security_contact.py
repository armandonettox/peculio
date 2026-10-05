"""Contato de seguranca da instalacao: o administrador define, quem usa o app le, e o /.well-known/security.txt
(RFC 9116) publica."""

import re
from datetime import datetime, timedelta, timezone

import pytest

from app.models.instance_setting import InstanceSetting
from tests.conftest import auth_headers, bearer, login_token, make_user, register

API = "/api/v1/instance/security-contact"
TXT = "/.well-known/security.txt"


def put(client, headers, contact):
    return client.put(API, json={"contact": contact}, headers=headers)


@pytest.fixture
def admin(client):
    register(client)
    return auth_headers(client)


@pytest.fixture
def member(client, db_session, admin):
    make_user(db_session, email="membro@example.com")
    return auth_headers(client, email="membro@example.com")


# ---------- Ler ----------


def test_reading_requires_login(client):
    assert client.get(API).status_code == 401


def test_starts_without_contact(client, admin):
    body = client.get(API, headers=admin).json()
    assert body == {"contact": None, "updated_at": None}


def test_any_logged_user_can_read_the_contact(client, admin, member):
    put(client, admin, "seguranca@example.com")
    body = client.get(API, headers=member).json()
    assert body["contact"] == "seguranca@example.com"
    assert body["updated_at"] is not None


# ---------- Gravar ----------


def test_admin_sets_an_email_and_it_is_lowercased(client, admin):
    resp = put(client, admin, "  Seguranca@Example.COM ")
    assert resp.status_code == 200
    assert resp.json()["contact"] == "seguranca@example.com"
    assert client.get(API, headers=admin).json()["contact"] == "seguranca@example.com"


def test_admin_sets_an_https_address(client, admin):
    resp = put(client, admin, "https://exemplo.com/contato-de-seguranca")
    assert resp.status_code == 200
    assert resp.json()["contact"] == "https://exemplo.com/contato-de-seguranca"


def test_https_prefix_is_case_insensitive_and_kept_as_typed(client, admin):
    assert put(client, admin, "HTTPS://exemplo.com/c").json()["contact"] == "HTTPS://exemplo.com/c"


def test_https_address_is_trimmed(client, admin):
    assert put(client, admin, "   https://exemplo.com/contato  ").json()["contact"] == "https://exemplo.com/contato"


def test_a_second_save_replaces_the_first(client, admin, db_session):
    put(client, admin, "um@example.com")
    resp = put(client, admin, "dois@example.com")
    assert resp.json()["contact"] == "dois@example.com"
    assert db_session.query(InstanceSetting).count() == 1


def test_a_member_cannot_change_it(client, admin, member):
    put(client, admin, "seguranca@example.com")
    resp = put(client, member, "invasor@example.com")
    assert resp.status_code == 403
    assert resp.json()["code"] == "admin_required"
    assert client.get(API, headers=admin).json()["contact"] == "seguranca@example.com"


def test_changing_requires_login(client):
    assert client.put(API, json={"contact": "a@example.com"}).status_code == 401


def test_an_api_token_cannot_change_it(client, admin):
    raw = client.post("/api/v1/api-tokens", json={"name": "t", "scope": "write"}, headers=admin).json()["token"]
    resp = put(client, bearer(raw), "invasor@example.com")
    assert resp.status_code == 403
    assert resp.json()["code"] == "session_required"


@pytest.mark.parametrize(
    "value",
    [
        "isto nao e um contato",
        "sem-arroba.example.com",
        "http://exemplo.com/contato",
        "javascript:alert(1)",
        "mailto:alguem@example.com",
        "ftp://exemplo.com",
        "https://",
        "https:///so-caminho",
        "https://usuario:senha@exemplo.com/",
        "https://exemplo.com/com espaco",
        "https://exemplo.com/quebra\nde-linha",
        "a@b",
    ],
)
def test_invalid_contacts_are_refused(client, admin, value):
    resp = put(client, admin, value)
    assert resp.status_code == 422, value
    assert client.get(API, headers=admin).json()["contact"] is None


def test_length_limit(client, admin):
    ok = "https://exemplo.com/" + "a" * (200 - len("https://exemplo.com/"))
    assert len(ok) == 200
    assert put(client, admin, ok).status_code == 200
    assert put(client, admin, ok + "a").status_code == 422


@pytest.mark.parametrize("empty", [None, "", "   "])
def test_empty_value_clears_the_contact(client, admin, empty):
    put(client, admin, "seguranca@example.com")
    resp = put(client, admin, empty)
    assert resp.status_code == 200
    assert resp.json() == {"contact": None, "updated_at": None}
    assert client.get(API, headers=admin).json()["contact"] is None


def test_clearing_when_there_is_nothing_is_fine(client, admin):
    assert put(client, admin, None).status_code == 200


# ---------- security.txt ----------


def test_security_txt_is_404_without_contact(client, admin):
    resp = client.get(TXT)
    assert resp.status_code == 404
    assert resp.json()["code"] == "security_contact_not_set"


def test_security_txt_is_public_and_plain_text(client, admin):
    put(client, admin, "seguranca@example.com")
    resp = client.get(TXT)  # sem cabecalho de login
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert resp.headers["cache-control"] == "no-cache"


def test_security_txt_email_becomes_mailto(client, admin):
    put(client, admin, "seguranca@example.com")
    lines = client.get(TXT).text.splitlines()
    assert lines[0] == "Contact: mailto:seguranca@example.com"


def test_security_txt_https_address_stays_as_is(client, admin):
    put(client, admin, "https://exemplo.com/contato")
    assert client.get(TXT).text.splitlines()[0] == "Contact: https://exemplo.com/contato"


def test_security_txt_keeps_an_uppercase_https_address_as_an_address(client, admin):
    put(client, admin, "HTTPS://exemplo.com/contato")
    assert client.get(TXT).text.splitlines()[0] == "Contact: HTTPS://exemplo.com/contato"


def test_security_txt_has_a_valid_expiry_about_180_days_ahead(client, admin):
    put(client, admin, "seguranca@example.com")
    text = client.get(TXT).text
    match = re.search(r"^Expires: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z)$", text, re.M)
    assert match, text
    expires = datetime.strptime(match.group(1), "%Y-%m-%dT%H:%M:%S.000Z").replace(tzinfo=timezone.utc)
    delta = expires - datetime.now(timezone.utc)
    assert timedelta(days=179) < delta < timedelta(days=181)


def test_security_txt_declares_languages_and_ends_with_a_newline(client, admin):
    put(client, admin, "seguranca@example.com")
    text = client.get(TXT).text
    assert "Preferred-Languages: pt-BR, en\n" in text
    assert text.endswith("\n")


def test_security_txt_follows_the_current_contact(client, admin):
    put(client, admin, "um@example.com")
    put(client, admin, "dois@example.com")
    assert "mailto:dois@example.com" in client.get(TXT).text
    put(client, admin, None)
    assert client.get(TXT).status_code == 404


def test_security_txt_is_not_in_the_api_schema_but_the_contact_is(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert TXT not in paths
    assert API in paths


def test_login_still_works_after_the_setting_exists(client, admin):
    put(client, admin, "seguranca@example.com")
    assert login_token(client)

import pytest
from starlette.requests import Request

from app.core.config import settings
from app.core.rate_limit import client_key, limiter
from tests.conftest import register


@pytest.fixture
def rate_limit_on():
    limiter.enabled = True
    limiter.reset()
    yield
    limiter.reset()
    limiter.enabled = False


def fake_request(headers: dict | None = None, client_ip: str = "10.0.0.1") -> Request:
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {"type": "http", "headers": raw_headers, "client": (client_ip, 1234)}
    return Request(scope)


def test_login_is_rate_limited(client, rate_limit_on):
    register(client)
    body = {"email": "admin@example.com", "password": "SenhaErrada1"}
    codes = [client.post("/api/v1/auth/login", json=body).status_code for _ in range(12)]
    assert 429 in codes
    # Antes do limite as tentativas normais respondem 401 (ou 423 se a conta bloqueou)
    assert codes[0] in (401, 423)


def test_forwarded_header_ignored_by_default(monkeypatch):
    monkeypatch.setattr(settings, "trust_proxy_headers", False)
    request = fake_request({"X-Forwarded-For": "1.2.3.4"})
    assert client_key(request) == "10.0.0.1"


def test_forwarded_header_used_behind_trusted_proxy(monkeypatch):
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    request = fake_request({"X-Forwarded-For": "1.2.3.4, 10.0.0.1"})
    assert client_key(request) == "1.2.3.4"


def test_trusted_proxy_without_header_falls_back_to_socket_ip(monkeypatch):
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    assert client_key(fake_request()) == "10.0.0.1"

"""Apoio dos testes de webhooks: resolvedor de DNS falso e atalhos. Nada aqui usa rede de verdade."""

import httpx
import pytest

from app.core import webhook_url
from app.services import webhook_delivery

PUBLIC_IP = "93.184.216.34"

# Nome -> IPs. Qualquer outro nome termina em PUBLIC_IP, como se fosse um site publico.
FAKE_DNS = {
    "internal.example.com": ["10.0.0.5"],
    "rebind.example.com": ["93.184.216.34", "192.168.1.10"],
    "localhost": ["127.0.0.1"],
}


def fake_resolver(host: str) -> list[str]:
    return FAKE_DNS.get(host, [PUBLIC_IP])


@pytest.fixture(autouse=True)
def no_real_dns(monkeypatch):
    monkeypatch.setattr(webhook_url, "default_resolver", fake_resolver)


class FakeServer:
    """Servidor HTTP falso (httpx.MockTransport) que guarda o que recebeu."""

    def __init__(self, handler=None):
        self.requests: list[httpx.Request] = []
        self.handler = handler or (lambda request: httpx.Response(200, text="ok"))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self), follow_redirects=False)


@pytest.fixture(autouse=True)
def server(monkeypatch):
    fake = FakeServer()
    monkeypatch.setattr(webhook_delivery, "client_factory", fake.client)
    return fake

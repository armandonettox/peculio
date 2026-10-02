"""DNS rebinding: o IP validado e o IP usado na conexao.

O endereco e resolvido uma vez, todos os IPs sao validados e a conexao vai para um IP validado,
mantendo o nome original no Host e no SNI (e a verificacao do certificado contra o nome)."""

import datetime
import ipaddress
import ssl
import threading
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from app.core import webhook_url
from app.core.config import settings
from app.core.two_factor import encrypt_secret
from app.models.webhook import Webhook
from app.services import webhook_delivery as delivery_service
from tests.webhook_support import PUBLIC_IP, no_real_dns  # noqa: F401

NOW = datetime.datetime(2040, 1, 1, tzinfo=datetime.timezone.utc)
OTHER_PUBLIC_IP = "93.184.216.35"
IPV6_PUBLIC = "2606:4700:4700::1111"


class Recorder:
    """Transporte falso por baixo do PinnedTransport: guarda o que realmente iria para a rede."""

    def __init__(self, handler=None):
        self.requests: list[httpx.Request] = []
        self.handler = handler or (lambda request: httpx.Response(200, text="ok"))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        # Guarda copias: o PinnedTransport mexe na requisicao antes de entregar para ca
        self.requests.append(request)
        return self.handler(request)


@pytest.fixture
def wire(monkeypatch):
    recorder = Recorder()
    monkeypatch.setattr(
        delivery_service,
        "client_factory",
        lambda: delivery_service.make_client(inner=httpx.MockTransport(recorder)),
    )
    return recorder


def webhook(url="https://hooks.example.com/finance?token=abc"):
    return Webhook(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name="Teste",
        url=url,
        secret_encrypted=encrypt_secret("segredo"),
        events=["transaction.created"],
    )


def post(url, resolver):
    hook = webhook(url)
    return delivery_service.post_webhook(
        hook.url, hook.secret_encrypted, uuid.uuid4(), "transaction.created", {"a": 1}, NOW, resolver
    )


# ---------- validate_webhook_url devolve os IPs validados ----------


def test_validation_returns_the_validated_addresses():
    result = webhook_url.validate_webhook_url(
        "https://hooks.example.com/x", resolver=lambda host: [PUBLIC_IP, OTHER_PUBLIC_IP]
    )
    assert result == [PUBLIC_IP, OTHER_PUBLIC_IP]


def test_validation_of_an_ip_literal_returns_that_ip():
    assert webhook_url.validate_webhook_url("https://93.184.216.34/x") == ["93.184.216.34"]


def test_validation_with_allow_private_resolves_nothing():
    def boom(host):
        raise AssertionError("nao devia consultar DNS")

    assert webhook_url.validate_webhook_url("http://10.0.0.5/x", resolver=boom, allow_private=True) == []


def test_validation_still_refuses_when_any_address_is_internal():
    with pytest.raises(webhook_url.WebhookUrlError):
        webhook_url.validate_webhook_url(
            "https://hooks.example.com/x", resolver=lambda host: [PUBLIC_IP, "192.168.1.10"]
        )


# ---------- A conexao vai para o IP validado ----------


def test_the_request_goes_to_the_validated_ip_with_the_original_host_and_sni(wire):
    outcome = post("https://hooks.example.com/finance?token=abc", lambda host: [PUBLIC_IP])
    assert outcome.ok is True
    request = wire.requests[0]
    assert request.url.host == PUBLIC_IP
    assert request.url.scheme == "https"
    assert request.url.path == "/finance"
    assert request.url.query == b"token=abc"
    assert request.headers["host"] == "hooks.example.com"
    assert request.extensions["sni_hostname"] == "hooks.example.com"
    # A extensao interna do pino nao vaza para a camada de rede
    assert delivery_service.PIN_EXTENSION not in request.extensions


def test_the_original_port_is_kept_in_the_url_and_in_the_host_header(wire):
    post("https://hooks.example.com:8443/finance", lambda host: [PUBLIC_IP])
    request = wire.requests[0]
    assert request.url.host == PUBLIC_IP
    assert request.url.port == 8443
    assert request.headers["host"] == "hooks.example.com:8443"
    assert request.extensions["sni_hostname"] == "hooks.example.com"


def test_ipv6_addresses_are_pinned_too(wire):
    post("https://hooks.example.com/finance", lambda host: [IPV6_PUBLIC])
    request = wire.requests[0]
    assert ipaddress.ip_address(request.url.host) == ipaddress.ip_address(IPV6_PUBLIC)
    assert request.headers["host"] == "hooks.example.com"
    assert request.extensions["sni_hostname"] == "hooks.example.com"


def test_dns_is_consulted_once_and_a_rebind_to_a_private_ip_is_never_used(wire):
    """Publico na validacao, privado se perguntassem de novo: so o publico validado e usado."""
    answers = iter([[PUBLIC_IP], ["10.0.0.7"], ["169.254.169.254"]])
    calls = []

    def rebinding_resolver(host):
        calls.append(host)
        return next(answers)

    outcome = post("https://hooks.example.com/finance", rebinding_resolver)
    assert outcome.ok is True
    assert calls == ["hooks.example.com"]
    assert [request.url.host for request in wire.requests] == [PUBLIC_IP]
    assert not any(ipaddress.ip_address(r.url.host).is_private for r in wire.requests)


def test_a_private_answer_at_validation_time_sends_nothing(wire):
    outcome = post("https://hooks.example.com/finance", lambda host: ["10.0.0.7"])
    assert outcome.ok is False
    assert "rede interna" in outcome.error
    assert wire.requests == []


def test_rebinding_through_the_real_default_resolver_hook(wire, monkeypatch):
    """Mesmo caminho da producao (resolvedor padrao trocado): so o IP da validacao chega na rede."""
    answers = iter([[PUBLIC_IP], ["127.0.0.1"]])
    monkeypatch.setattr(webhook_url, "default_resolver", lambda host: next(answers))
    hook = webhook()
    outcome = delivery_service.post_webhook(
        hook.url, hook.secret_encrypted, uuid.uuid4(), "transaction.created", {"a": 1}, NOW
    )
    assert outcome.ok is True
    assert [request.url.host for request in wire.requests] == [PUBLIC_IP]


def test_send_test_is_pinned_as_well(wire, db_session, monkeypatch):
    from tests.conftest import make_user

    user = make_user(db_session)
    hook = webhook()
    hook.user_id = user.id
    db_session.add(hook)
    db_session.commit()
    answers = iter([[PUBLIC_IP], ["10.1.1.1"]])
    monkeypatch.setattr(webhook_url, "default_resolver", lambda host: next(answers))
    delivery = delivery_service.send_test(db_session, hook)
    assert delivery.status.value == "delivered"
    assert [request.url.host for request in wire.requests] == [PUBLIC_IP]


# ---------- Varios IPs: tenta os validados, so eles ----------


def test_next_validated_ip_is_tried_when_the_connection_to_the_first_fails(wire):
    def handler(request):
        if request.url.host == PUBLIC_IP:
            raise httpx.ConnectError("recusado", request=request)
        return httpx.Response(200)

    wire.handler = handler
    outcome = post("https://hooks.example.com/x", lambda host: [PUBLIC_IP, OTHER_PUBLIC_IP])
    assert outcome.ok is True
    assert [request.url.host for request in wire.requests] == [PUBLIC_IP, OTHER_PUBLIC_IP]


def test_all_connections_failing_is_a_connection_failure(wire):
    def handler(request):
        raise httpx.ConnectError("recusado", request=request)

    wire.handler = handler
    outcome = post("https://hooks.example.com/x", lambda host: [PUBLIC_IP, OTHER_PUBLIC_IP])
    assert outcome.ok is False
    assert "Falha de conexao" in outcome.error
    assert len(wire.requests) == 2


def test_connect_timeout_on_every_ip_is_reported_as_timeout(wire):
    def handler(request):
        raise httpx.ConnectTimeout("demorou", request=request)

    wire.handler = handler
    outcome = post("https://hooks.example.com/x", lambda host: [PUBLIC_IP, OTHER_PUBLIC_IP])
    assert "Tempo esgotado" in outcome.error
    assert [request.url.host for request in wire.requests] == [PUBLIC_IP, OTHER_PUBLIC_IP]


def test_a_failure_after_connecting_does_not_resend_to_another_ip(wire):
    def handler(request):
        raise httpx.ReadError("conexao caiu", request=request)

    wire.handler = handler
    outcome = post("https://hooks.example.com/x", lambda host: [PUBLIC_IP, OTHER_PUBLIC_IP])
    assert "Falha de conexao" in outcome.error
    assert len(wire.requests) == 1


def test_an_http_error_response_does_not_try_other_ips(wire):
    wire.handler = lambda request: httpx.Response(500, text="quebrou")
    outcome = post("https://hooks.example.com/x", lambda host: [PUBLIC_IP, OTHER_PUBLIC_IP])
    assert outcome.status_code == 500
    assert len(wire.requests) == 1


def test_a_read_timeout_does_not_resend_to_another_ip(wire):
    def handler(request):
        raise httpx.ReadTimeout("demorou", request=request)

    wire.handler = handler
    outcome = post("https://hooks.example.com/x", lambda host: [PUBLIC_IP, OTHER_PUBLIC_IP])
    assert "Tempo esgotado" in outcome.error
    assert len(wire.requests) == 1


def test_at_most_three_addresses_are_tried(wire):
    def handler(request):
        raise httpx.ConnectError("recusado", request=request)

    wire.handler = handler
    many = [f"93.184.216.{n}" for n in range(30, 38)]
    post("https://hooks.example.com/x", lambda host: many)
    assert [request.url.host for request in wire.requests] == many[:3]


# ---------- Casos sem pino ----------


def test_an_ip_literal_url_is_not_rewritten_and_has_no_sni_override(wire):
    post("https://93.184.216.34/finance", lambda host: pytest.fail("nao devia resolver"))
    request = wire.requests[0]
    assert request.url.host == "93.184.216.34"
    assert "sni_hostname" not in request.extensions


def test_allow_private_mode_keeps_the_hostname_and_does_not_resolve(wire, monkeypatch):
    monkeypatch.setattr(settings, "webhook_allow_private", True)

    def boom(host):
        raise AssertionError("nao devia consultar DNS")

    post("http://home-assistant.local:8123/api/webhook/x", boom)
    request = wire.requests[0]
    assert request.url.host == "home-assistant.local"
    assert request.url.port == 8123
    assert "sni_hostname" not in request.extensions


def test_the_real_client_is_wrapped_in_the_pinning_transport():
    with delivery_service.make_client() as client:
        assert isinstance(client._transport, delivery_service.PinnedTransport)
        assert client.follow_redirects is False


# ---------- TLS de verdade: SNI e certificado contra o nome original ----------


def make_cert(tmp_path, hostname):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(hostname)]), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_path = tmp_path / f"{hostname}.crt"
    key_path = tmp_path / f"{hostname}.key"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    return cert_path, key_path


class TlsServer:
    def __init__(self, cert_path, key_path):
        self.seen_sni = []
        self.seen_host = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                outer.seen_host.append(self.headers.get("Host"))
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, *args):
                pass

        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(str(cert_path), str(key_path))
        context.sni_callback = lambda sock, name, ctx: self.seen_sni.append(name)
        self.httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.socket = context.wrap_socket(self.httpd.socket, server_side=True)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def pinned_client(cert_path):
    context = ssl.create_default_context(cafile=str(cert_path))
    return httpx.Client(
        transport=delivery_service.PinnedTransport(httpx.HTTPTransport(verify=context)),
        timeout=5,
        follow_redirects=False,
    )


def test_real_tls_connects_to_the_pinned_ip_with_sni_and_certificate_checked_against_the_hostname(tmp_path):
    cert_path, key_path = make_cert(tmp_path, "hooks.example.com")
    server = TlsServer(cert_path, key_path)
    try:
        with pinned_client(cert_path) as client:
            response = client.post(
                f"https://hooks.example.com:{server.port}/finance",
                content=b"{}",
                extensions={delivery_service.PIN_EXTENSION: "127.0.0.1"},
            )
        assert response.status_code == 200
        assert server.seen_sni == ["hooks.example.com"]
        assert server.seen_host == [f"hooks.example.com:{server.port}"]
    finally:
        server.stop()


def test_real_tls_refuses_a_certificate_for_another_name(tmp_path):
    cert_path, key_path = make_cert(tmp_path, "other.example.com")
    server = TlsServer(cert_path, key_path)
    try:
        with pinned_client(cert_path) as client:
            with pytest.raises(httpx.ConnectError):
                client.post(
                    f"https://hooks.example.com:{server.port}/finance",
                    content=b"{}",
                    extensions={delivery_service.PIN_EXTENSION: "127.0.0.1"},
                )
    finally:
        server.stop()

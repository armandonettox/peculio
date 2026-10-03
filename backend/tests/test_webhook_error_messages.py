"""Mensagens de falha dos webhooks: texto para a pessoa, sem nome de excecao do Python."""

import logging
import ssl

import httpx
import pytest

from app.services import webhook_delivery as delivery_service
from tests.test_webhook_pinning import TlsServer, make_cert, pinned_client

REQUEST = httpx.Request("POST", "https://hooks.example.com/x")

CERT = "O certificado HTTPS do endereco nao e valido ou nao confere com o nome do site"
TLS = "Nao foi possivel abrir a conexao segura (HTTPS) com o endereco"
CONNECT = "Nao foi possivel conectar ao endereco: o servidor esta fora do ar ou recusou a conexao"
DROPPED = "A conexao com o endereco foi interrompida antes de terminar a resposta"


def with_cause(error: httpx.HTTPError, cause: BaseException) -> httpx.HTTPError:
    error.__cause__ = cause
    return error


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (httpx.ConnectError("recusado", request=REQUEST), CONNECT),
        (httpx.ReadError("caiu", request=REQUEST), DROPPED),
        (httpx.WriteError("caiu", request=REQUEST), DROPPED),
        (httpx.RemoteProtocolError("lixo", request=REQUEST), DROPPED),
        (httpx.CloseError("fechou", request=REQUEST), DROPPED),
        (httpx.UnsupportedProtocol("protocolo", request=REQUEST), DROPPED),
        (httpx.ProxyError("proxy", request=REQUEST), DROPPED),
        (with_cause(httpx.ConnectError("x", request=REQUEST), ssl.SSLCertVerificationError("falhou")), CERT),
        (with_cause(httpx.ConnectError("x", request=REQUEST), ssl.SSLError("handshake")), TLS),
        (with_cause(httpx.ConnectError("x", request=REQUEST), ssl.SSLZeroReturnError("fechou")), TLS),
        (with_cause(httpx.ConnectError("x", request=REQUEST), OSError("rede")), CONNECT),
        (with_cause(httpx.ReadError("x", request=REQUEST), ssl.SSLError("meio da leitura")), TLS),
    ],
)
def test_each_failure_has_its_own_plain_message(error, expected):
    assert delivery_service.explain_http_error(error) == expected


def test_the_tls_error_is_found_through_the_context_chain_too():
    inner = ssl.SSLCertVerificationError("falhou")
    middle = OSError("meio")
    middle.__context__ = inner
    error = httpx.ConnectError("x", request=REQUEST)
    error.__cause__ = middle
    assert delivery_service.explain_http_error(error) == CERT


def test_a_circular_cause_chain_does_not_loop_forever():
    first = httpx.ConnectError("a", request=REQUEST)
    second = OSError("b")
    first.__cause__ = second
    second.__cause__ = first
    assert delivery_service.explain_http_error(first) == CONNECT


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("recusado", request=REQUEST),
        httpx.ReadError("caiu", request=REQUEST),
        with_cause(httpx.ConnectError("x", request=REQUEST), ssl.SSLCertVerificationError("falhou")),
    ],
)
def test_messages_never_expose_a_python_class_name(error):
    text = delivery_service.explain_http_error(error)
    for word in ("Error", "Exception", "httpx", "ssl.", "Traceback"):
        assert word not in text


def test_a_refused_connection_is_reported_without_the_class_name(wire_like):
    outcome = wire_like(httpx.ConnectError("recusado", request=REQUEST))
    assert outcome.ok is False
    assert outcome.error == CONNECT


def test_an_unexpected_error_hides_the_class_name_but_keeps_it_in_the_log(wire_like, caplog):
    class Weird(Exception):
        pass

    with caplog.at_level(logging.WARNING, logger="finance-app.webhooks"):
        outcome = wire_like(Weird("segredo interno"))
    assert outcome.ok is False
    assert "Weird" not in outcome.error
    assert "segredo interno" not in outcome.error
    assert outcome.error.startswith("Erro inesperado ao entregar o aviso")
    assert any("Weird" in record.getMessage() for record in caplog.records)


def test_the_class_name_of_a_connection_failure_goes_to_the_log(wire_like, caplog):
    with caplog.at_level(logging.INFO, logger="finance-app.webhooks"):
        wire_like(httpx.ReadError("caiu", request=REQUEST))
    assert any("ReadError" in record.getMessage() for record in caplog.records)


# ---------- Com TLS de verdade ----------


def test_a_certificate_for_another_name_is_explained_as_a_certificate_problem(tmp_path):
    cert_path, key_path = make_cert(tmp_path, "other.example.com")
    server = TlsServer(cert_path, key_path)
    try:
        with pinned_client(cert_path) as client:
            with pytest.raises(httpx.ConnectError) as caught:
                client.post(
                    f"https://hooks.example.com:{server.port}/finance",
                    content=b"{}",
                    extensions={delivery_service.PIN_EXTENSION: "127.0.0.1"},
                )
    finally:
        server.stop()
    assert delivery_service.explain_http_error(caught.value) == CERT


@pytest.fixture
def wire_like(monkeypatch):
    """Roda post_webhook com um cliente cujo transporte levanta a excecao pedida."""
    from tests.test_webhook_pinning import post

    def run(exception):
        def handler(request):
            raise exception

        client_handler = handler
        monkeypatch.setattr(
            delivery_service,
            "client_factory",
            lambda: httpx.Client(transport=httpx.MockTransport(client_handler)),
        )
        return post("https://hooks.example.com/x", lambda host: ["93.184.216.34"])

    return run

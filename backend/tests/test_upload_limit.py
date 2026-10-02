import asyncio
import json

import pytest

from app.core.config import settings
from app.core.errors import AppError
from app.core.upload_limit import MULTIPART_OVERHEAD, UploadSizeLimitMiddleware
from tests.conftest import auth_headers, register

UPLOAD_PATH = "/api/v1/transactions/3f0b1c9e-0000-4000-8000-000000000001/attachments"
LIMIT = 1000
HARD_LIMIT = LIMIT + MULTIPART_OVERHEAD


@pytest.fixture(autouse=True)
def small_limit(monkeypatch):
    monkeypatch.setattr(settings, "attachment_max_bytes", LIMIT)


def scope(path=UPLOAD_PATH, method="POST", length=None, kind="http"):
    headers = [(b"content-type", b"multipart/form-data; boundary=x")]
    if length is not None:
        headers.append((b"content-length", str(length).encode()))
    return {"type": kind, "method": method, "path": path, "headers": headers}


class Recorder:
    """App de mentira: le o corpo inteiro e anota o que viu."""

    def __init__(self):
        self.called = False
        self.body = b""
        self.reads = 0

    async def __call__(self, scope, receive, send):
        self.called = True
        while True:
            message = await receive()
            self.reads += 1
            self.body += message.get("body", b"")
            if not message.get("more_body", False):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})


def run(scope_, chunks, app=None):
    """Roda o middleware com um corpo em partes. Devolve (app, mensagens enviadas, partes lidas)."""
    app = app or Recorder()
    middleware = UploadSizeLimitMiddleware(app)
    sent = []
    consumed = []
    pending = list(chunks)

    async def receive():
        consumed.append(1)
        if not pending:
            raise AssertionError("o corpo foi lido alem do que existia")
        chunk = pending.pop(0)
        return {"type": "http.request", "body": chunk, "more_body": bool(pending)}

    async def send(message):
        sent.append(message)

    asyncio.run(middleware(scope_, receive, send))
    return app, sent, len(consumed)


def status_of(sent):
    return next(m["status"] for m in sent if m["type"] == "http.response.start")


# ---------- Content-Length declarado ----------


def test_declared_size_over_the_limit_is_refused_without_reading_the_body():
    app, sent, reads = run(scope(length=HARD_LIMIT + 1), [])
    assert reads == 0
    assert app.called is False
    assert status_of(sent) == 413
    body = json.loads(next(m["body"] for m in sent if m["type"] == "http.response.body"))
    assert body == {"detail": "O arquivo passa do limite de 0 MB", "code": "attachment_too_large"}
    headers = dict(next(m["headers"] for m in sent if m["type"] == "http.response.start"))
    assert headers[b"connection"] == b"close"
    assert headers[b"content-type"] == b"application/json"
    assert int(headers[b"content-length"]) == len(next(m["body"] for m in sent if m["type"] == "http.response.body"))


def test_declared_size_exactly_at_the_limit_passes():
    app, sent, _ = run(scope(length=HARD_LIMIT), [b"x" * 10])
    assert app.called is True
    assert status_of(sent) == 200


def test_one_byte_over_is_the_first_refused():
    app, _, _ = run(scope(length=HARD_LIMIT), [b"x"])
    assert app.called
    app, sent, _ = run(scope(length=HARD_LIMIT + 1), [b"x"])
    assert not app.called and status_of(sent) == 413


def test_message_shows_the_configured_limit_in_mb(monkeypatch):
    monkeypatch.setattr(settings, "attachment_max_bytes", 5 * 1024 * 1024)
    _, sent, _ = run(scope(length=10 * 1024 * 1024), [])
    body = json.loads(next(m["body"] for m in sent if m["type"] == "http.response.body"))
    assert body["detail"] == "O arquivo passa do limite de 5 MB"


def test_a_garbage_content_length_is_not_trusted_and_the_stream_is_still_counted():
    app, sent, _ = run(scope(length=None), [b"x" * 10])
    assert app.called and status_of(sent) == 200
    bad = scope()
    bad["headers"].append((b"content-length", b"abc"))
    app, sent, _ = run(bad, [b"x" * 10])
    assert app.called and status_of(sent) == 200


# ---------- Corpo em partes, sem Content-Length ----------


def test_stream_over_the_limit_is_cut_as_soon_as_it_passes_it():
    chunk = b"x" * (HARD_LIMIT // 2 + 1)
    chunks = [chunk] * 10
    recorder = Recorder()
    with pytest.raises(AppError) as error:
        run(scope(), chunks, recorder)
    assert error.value.status_code == 413
    assert error.value.code.value == "attachment_too_large"
    # Duas partes ja passam do limite: nao leu as outras oito
    assert recorder.reads == 1


def test_stream_exactly_at_the_limit_passes_and_arrives_whole():
    chunks = [b"a" * (HARD_LIMIT // 2), b"b" * (HARD_LIMIT - HARD_LIMIT // 2)]
    app, sent, reads = run(scope(), chunks)
    assert status_of(sent) == 200
    assert len(app.body) == HARD_LIMIT
    assert reads == 2


def test_stream_one_byte_over_is_cut():
    chunks = [b"a" * HARD_LIMIT, b"b"]
    with pytest.raises(AppError):
        run(scope(), chunks)


def test_small_bodies_pass_untouched():
    app, sent, _ = run(scope(length=7), [b"abc", b"defg"])
    assert status_of(sent) == 200
    assert app.body == b"abcdefg"


# ---------- Onde vale ----------


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/api/v1/auth/login", "POST"),
        ("/api/v1/transactions", "POST"),
        (UPLOAD_PATH, "GET"),
        (UPLOAD_PATH, "DELETE"),
        (UPLOAD_PATH + "/extra", "POST"),
        (UPLOAD_PATH + "x", "POST"),
        ("/api/v1/attachments/abc/download", "POST"),
        ("/outra/transactions/abc/attachments", "POST"),
        ("/api/v1/transactions/abc/def/attachments", "POST"),
    ],
)
def test_other_routes_and_methods_are_not_limited(path, method):
    app, sent, _ = run(scope(path=path, method=method, length=HARD_LIMIT * 5), [b"x" * 10])
    assert app.called and status_of(sent) == 200


def test_trailing_slash_upload_path_is_limited_too():
    app, sent, _ = run(scope(path=UPLOAD_PATH + "/", length=HARD_LIMIT + 1), [])
    assert not app.called and status_of(sent) == 413


def test_non_http_scopes_pass_through():
    app = Recorder()
    middleware = UploadSizeLimitMiddleware(app)

    async def receive():
        return {"type": "lifespan.startup"}

    async def send(message):
        pass

    class Passthrough:
        called = False

        async def __call__(self, scope, receive, send):
            self.called = True

    inner = Passthrough()
    asyncio.run(UploadSizeLimitMiddleware(inner)(scope(kind="lifespan", length=HARD_LIMIT * 9), receive, send))
    assert inner.called


# ---------- Pela API completa ----------


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_transaction(client, headers):
    account = client.post(
        "/api/v1/accounts",
        json={"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "100.00"},
        headers=headers,
    ).json()["id"]
    split = {
        "type": "withdrawal", "date": "2026-03-10", "description": "Compra", "amount": "10.00",
        "currency_code": "BRL", "account_id": account, "counterparty_name": "Loja",
    }
    return client.post("/api/v1/transactions", json={"splits": [split]}, headers=headers).json()["id"]


def test_big_upload_through_the_api_is_413_with_the_standard_error_and_stores_nothing(client, headers, tmp_path, monkeypatch):
    storage = tmp_path / "attachments"
    monkeypatch.setattr(settings, "attachments_dir", str(storage))
    transaction_id = make_transaction(client, headers)
    big = b"%PDF-1.4\n" + b"x" * (HARD_LIMIT + 5000)
    response = client.post(
        f"/api/v1/transactions/{transaction_id}/attachments",
        files={"file": ("nota.pdf", big, "application/pdf")},
        headers=headers,
    )
    assert response.status_code == 413
    assert response.json()["code"] == "attachment_too_large"
    assert not storage.exists() or not list(storage.rglob("*.*"))
    listing = client.get(f"/api/v1/transactions/{transaction_id}/attachments", headers=headers).json()
    assert listing == []


def test_a_small_upload_through_the_api_still_works(client, headers, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "attachments_dir", str(tmp_path / "attachments"))
    transaction_id = make_transaction(client, headers)
    response = client.post(
        f"/api/v1/transactions/{transaction_id}/attachments",
        files={"file": ("nota.pdf", b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "application/pdf")},
        headers=headers,
    )
    assert response.status_code == 201


def test_file_over_the_limit_but_under_the_overhead_is_still_refused_by_the_route(client, headers, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "attachments_dir", str(tmp_path / "attachments"))
    transaction_id = make_transaction(client, headers)
    # Passa pelo middleware (cabe na folga do multipart) e cai na checagem exata da rota
    content = b"%PDF-1.4\n" + b"x" * (LIMIT + 100)
    response = client.post(
        f"/api/v1/transactions/{transaction_id}/attachments",
        files={"file": ("nota.pdf", content, "application/pdf")},
        headers=headers,
    )
    assert response.status_code == 413
    assert response.json()["code"] == "attachment_too_large"


def test_a_huge_upload_is_refused_before_authentication_is_even_checked(client):
    """Prova que o middleware esta no ar: sem ele, um token invalido daria 401 e nao 413."""
    response = client.post(
        UPLOAD_PATH,
        files={"file": ("nota.pdf", b"x" * (HARD_LIMIT + 5000), "application/pdf")},
        headers={"Authorization": "Bearer invalido"},
    )
    assert response.status_code == 413
    assert response.json()["code"] == "attachment_too_large"

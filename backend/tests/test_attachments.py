import re
import threading
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.main import app
from app.models.attachment import Attachment
from app.models.transaction import Transaction
from app.services.attachments import sanitize_name
from tests.conftest import auth_headers, make_user, register

TX_URL = "/api/v1/transactions"
ACCOUNTS_URL = "/api/v1/accounts"
DOWNLOAD_URL = "/api/v1/attachments/{}/download"
DELETE_URL = "/api/v1/attachments/{}"

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
WEBP = b"RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00" + b"\x00" * 14
TEXT = "Mercado;50,00\nPadaria;12,30\n".encode()
LATIN1_CSV = "descrição;valor\nação;10,00\n".encode("latin-1")


@pytest.fixture(autouse=True)
def storage_dir(tmp_path, monkeypatch):
    """Cada teste grava os anexos num diretorio temporario proprio."""
    directory = tmp_path / "attachments"
    monkeypatch.setattr(settings, "attachments_dir", str(directory))
    return directory


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, **overrides):
    body = {"name": f"Conta {uuid.uuid4().hex[:8]}", "type": "asset", "currency_code": "BRL", "opening_balance": "1000.00", **overrides}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


def withdrawal(account_id, **overrides):
    return {
        "type": "withdrawal",
        "date": "2026-02-01",
        "description": "Compra no mercado",
        "amount": "50.00",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Supermercado",
        **overrides,
    }


def make_transaction(client, headers, account_id=None, **overrides):
    account_id = account_id or make_account(client, headers)
    resp = client.post(TX_URL, json={"splits": [withdrawal(account_id, **overrides)]}, headers=headers)
    assert resp.status_code == 201
    return resp.json()["id"]


def upload(client, headers, transaction_id, content=PDF, filename="nota.pdf", content_type="application/octet-stream"):
    return client.post(
        f"{TX_URL}/{transaction_id}/attachments",
        files={"file": (filename, content, content_type)},
        headers=headers,
    )


def other_user_headers(client, db_session, email="outra@example.com"):
    make_user(db_session, email=email)
    return auth_headers(client, email=email)


def files_on_disk(storage_dir: Path) -> list[Path]:
    return [path for path in storage_dir.rglob("*") if path.is_file()] if storage_dir.exists() else []


def row_of(db_session, attachment_id) -> Attachment:
    db_session.expire_all()
    return db_session.get(Attachment, uuid.UUID(attachment_id))


# ---------- Acesso ----------


def test_requires_login(client):
    some_id = uuid.uuid4()
    assert client.post(f"{TX_URL}/{some_id}/attachments", files={"file": ("a.pdf", PDF)}).status_code == 401
    assert client.get(f"{TX_URL}/{some_id}/attachments").status_code == 401
    assert client.get(DOWNLOAD_URL.format(some_id)).status_code == 401
    assert client.delete(DELETE_URL.format(some_id)).status_code == 401


# ---------- Envio feliz, um por tipo ----------


@pytest.mark.parametrize(
    ("filename", "content", "expected_type"),
    [
        ("nota.pdf", PDF, "application/pdf"),
        ("foto.jpg", JPEG, "image/jpeg"),
        ("foto.JPEG", JPEG, "image/jpeg"),
        ("recibo.png", PNG, "image/png"),
        ("recibo.webp", WEBP, "image/webp"),
        ("notas.txt", TEXT, "text/plain"),
        ("extrato.csv", TEXT, "text/plain"),
        ("extrato-antigo.csv", LATIN1_CSV, "text/plain"),
    ],
)
def test_upload_each_allowed_type(client, headers, db_session, storage_dir, filename, content, expected_type):
    transaction_id = make_transaction(client, headers)
    resp = upload(client, headers, transaction_id, content, filename)

    assert resp.status_code == 201
    body = resp.json()
    assert body["transaction_id"] == transaction_id
    assert body["original_name"] == filename
    assert body["content_type"] == expected_type
    assert body["size_bytes"] == len(content)
    assert "storage_name" not in body
    assert "sha256" not in body

    row = row_of(db_session, body["id"])
    import hashlib

    assert row.sha256 == hashlib.sha256(content).hexdigest()
    assert re.fullmatch(r"[0-9a-f]{32}", row.storage_name)
    stored = storage_dir / str(row.user_id) / row.storage_name
    assert stored.read_bytes() == content
    assert files_on_disk(storage_dir) == [stored]


def test_declared_content_type_is_ignored(client, headers, db_session):
    transaction_id = make_transaction(client, headers)
    resp = upload(client, headers, transaction_id, PDF, "nota.pdf", content_type="image/png")
    assert resp.json()["content_type"] == "application/pdf"


def test_storage_path_never_uses_the_original_name(client, headers, db_session, storage_dir):
    transaction_id = make_transaction(client, headers)
    resp = upload(client, headers, transaction_id, PDF, "../../fuga.pdf")
    assert resp.status_code == 201
    stored = files_on_disk(storage_dir)
    assert len(stored) == 1
    assert "fuga" not in str(stored[0].relative_to(storage_dir))
    assert stored[0].parent == storage_dir / str(row_of(db_session, resp.json()["id"]).user_id)
    # Nada foi escrito fora do diretorio de anexos
    assert not (storage_dir.parent / "fuga.pdf").exists()
    assert not (storage_dir.parent.parent / "fuga.pdf").exists()


def test_no_temporary_file_is_left_after_upload(client, headers, storage_dir):
    transaction_id = make_transaction(client, headers)
    upload(client, headers, transaction_id)
    assert not [path for path in storage_dir.rglob("*") if path.name.startswith(".tmp-")]


# ---------- Tipos recusados (conferidos pelo conteudo) ----------

EXECUTABLE = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00"
HTML = b"<html><script>alert(1)</script></html>"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
ZIP = b"PK\x03\x04\x14\x00\x00\x00\x08\x00" + b"\x00" * 20
WAV = b"RIFF" + bytes([36, 0, 0, 0]) + b"WAVEfmt " + bytes(20)
GIF = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("virus.pdf", EXECUTABLE),
        ("pagina.png", HTML),
        ("pagina.html", HTML),
        ("desenho.svg", SVG),
        ("desenho.png", SVG),
        ("pacote.zip", ZIP),
        ("pacote.txt", ZIP),
        ("binario.txt", b"abc\x00def"),
        ("binario.csv", b"a;b\n1;2\x00\n"),
        ("animacao.gif", GIF),
        ("audio.webp", WAV),
        ("imagem.png", PDF),
        ("imagem.pdf", PNG),
        ("documento.txt", PDF),
        ("foto.png", JPEG),
        ("foto.jpg", WEBP),
        ("sem-extensao", PDF),
        ("sem-extensao", TEXT),
        ("texto.pdf", TEXT),
        ("texto.png", TEXT),
        ("texto.exe", TEXT),
        ("dupla.pdf.exe", PDF),
        (".pdf", PDF),
    ],
)
def test_disallowed_types_are_rejected(client, headers, db_session, storage_dir, filename, content):
    transaction_id = make_transaction(client, headers)
    resp = upload(client, headers, transaction_id, content, filename, content_type="application/pdf")

    assert resp.status_code == 415
    assert resp.json()["code"] == "attachment_type_not_allowed"
    assert db_session.scalar(select(Attachment.id)) is None
    assert files_on_disk(storage_dir) == []


def test_text_without_nul_in_a_later_chunk_is_checked_too(client, headers, db_session, storage_dir):
    transaction_id = make_transaction(client, headers)
    content = b"a" * (200 * 1024) + b"\x00" + b"b" * 10
    resp = upload(client, headers, transaction_id, content, "grande.txt")
    assert resp.status_code == 415
    assert files_on_disk(storage_dir) == []


def test_svg_renamed_to_txt_is_only_ever_served_as_plain_text(client, headers):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id, SVG, "desenho.txt").json()
    assert created["content_type"] == "text/plain"
    resp = client.get(DOWNLOAD_URL.format(created["id"]), headers=headers)
    assert resp.headers["content-type"] == "text/plain; charset=utf-8"
    assert "html" not in resp.headers["content-type"]


def test_empty_file_is_rejected(client, headers, storage_dir):
    transaction_id = make_transaction(client, headers)
    resp = upload(client, headers, transaction_id, b"", "vazio.txt")
    assert resp.status_code == 422
    assert resp.json()["code"] == "attachment_empty"
    assert files_on_disk(storage_dir) == []


def test_missing_file_field_is_a_validation_error(client, headers):
    transaction_id = make_transaction(client, headers)
    resp = client.post(f"{TX_URL}/{transaction_id}/attachments", data={"outro": "x"}, headers=headers)
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


# ---------- Tamanho ----------


def test_file_at_the_size_limit_is_accepted_and_one_byte_more_is_not(client, headers, monkeypatch, storage_dir):
    monkeypatch.setattr(settings, "attachment_max_bytes", 1000)
    transaction_id = make_transaction(client, headers)

    assert upload(client, headers, transaction_id, b"a" * 1000, "limite.txt").status_code == 201
    resp = upload(client, headers, transaction_id, b"a" * 1001, "passou.txt")
    assert resp.status_code == 413
    assert resp.json()["code"] == "attachment_too_large"
    assert len(files_on_disk(storage_dir)) == 1


def test_size_limit_is_enforced_across_chunks_without_leaving_files(client, headers, monkeypatch, storage_dir):
    monkeypatch.setattr(settings, "attachment_max_bytes", 200_000)
    transaction_id = make_transaction(client, headers)

    assert upload(client, headers, transaction_id, b"a" * 200_000, "ok.txt").status_code == 201
    resp = upload(client, headers, transaction_id, b"a" * 200_001, "grande.txt")
    assert resp.status_code == 413
    assert len(files_on_disk(storage_dir)) == 1


def test_default_limit_is_ten_megabytes():
    assert settings.attachment_max_bytes == 10 * 1024 * 1024


# ---------- Quantidade por lancamento ----------


def test_eleventh_attachment_is_rejected(client, headers, db_session, storage_dir):
    transaction_id = make_transaction(client, headers)
    for index in range(10):
        assert upload(client, headers, transaction_id, TEXT, f"nota-{index}.txt").status_code == 201

    resp = upload(client, headers, transaction_id, TEXT, "onze.txt")
    assert resp.status_code == 409
    assert resp.json()["code"] == "attachment_limit_reached"
    assert len(files_on_disk(storage_dir)) == 10

    # O limite e por lancamento
    other_transaction = make_transaction(client, headers, description="Outra compra")
    assert upload(client, headers, other_transaction, TEXT, "ok.txt").status_code == 201


def test_removing_one_frees_a_slot(client, headers):
    transaction_id = make_transaction(client, headers)
    ids = [upload(client, headers, transaction_id, TEXT, f"n{i}.txt").json()["id"] for i in range(10)]
    assert upload(client, headers, transaction_id, TEXT, "extra.txt").status_code == 409
    assert client.delete(DELETE_URL.format(ids[0]), headers=headers).status_code == 204
    assert upload(client, headers, transaction_id, TEXT, "extra.txt").status_code == 201


def test_concurrent_uploads_cannot_exceed_the_limit(client, headers, db_session, storage_dir):
    transaction_id = make_transaction(client, headers)
    for index in range(9):
        assert upload(client, headers, transaction_id, TEXT, f"nota-{index}.txt").status_code == 201

    results: list[int] = []
    barrier = threading.Barrier(4)

    def worker(index: int) -> None:
        with TestClient(app) as local:
            barrier.wait()
            results.append(upload(local, headers, transaction_id, TEXT, f"corrida-{index}.txt").status_code)

    threads = [threading.Thread(target=worker, args=(index,)) for index in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(results) == [201, 409, 409, 409]
    db_session.expire_all()
    assert len(db_session.scalars(select(Attachment)).all()) == 10
    assert len(files_on_disk(storage_dir)) == 10


def test_upload_waits_for_the_transaction_lock_and_sees_the_latest_count(client, headers, db_session, storage_dir):
    """O envio trava o lancamento: enquanto outra sessao o segura, ele espera e depois conta de novo."""
    transaction_id = make_transaction(client, headers)
    for index in range(9):
        assert upload(client, headers, transaction_id, TEXT, f"nota-{index}.txt").status_code == 201

    user_id = db_session.scalars(select(Transaction.user_id).where(Transaction.id == uuid.UUID(transaction_id))).one()
    holder = SessionLocal()
    holder.execute(select(Transaction).where(Transaction.id == uuid.UUID(transaction_id)).with_for_update())

    results: list[int] = []

    def worker() -> None:
        with TestClient(app) as local:
            results.append(upload(local, headers, transaction_id, TEXT, "esperando.txt").status_code)

    thread = threading.Thread(target=worker)
    thread.start()
    thread.join(timeout=2)
    # Segurando o lock, a outra sessao ainda nao terminou o envio
    assert thread.is_alive()
    assert results == []

    holder.add(
        Attachment(
            user_id=user_id,
            transaction_id=uuid.UUID(transaction_id),
            original_name="decimo.txt",
            content_type="text/plain",
            size_bytes=1,
            sha256="0" * 64,
            storage_name=uuid.uuid4().hex,
        )
    )
    holder.commit()
    holder.close()
    thread.join(timeout=20)

    assert results == [409]


# ---------- Higienizacao do nome ----------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("nota.pdf", "nota.pdf"),
        ("../../etc/passwd", "passwd"),
        ("a\\b.pdf", "b.pdf"),
        ("C:\\Users\\ana\\recibo.pdf", "recibo.pdf"),
        ("/etc/passwd", "passwd"),
        ("a/b\\c/d.txt", "d.txt"),
        ("a\x00b.pdf", "ab.pdf"),
        ("a\x1b[31mb.pdf", "a[31mb.pdf"),
        ("a\tb\n c.pdf", "a b c.pdf"),
        ("  muitos    espacos  .pdf", "muitos espacos .pdf"),
        ("relat\u00f3rio de mar\u00e7o.pdf", "relat\u00f3rio de mar\u00e7o.pdf"),
        ("\U0001F600 nota.png", "\U0001F600 nota.png"),
        ("exe\u202Egnp.pdf", "exegnp.pdf"),
        ("", "anexo"),
        (None, "anexo"),
        ("   ", "anexo"),
        ("..", "anexo"),
        (".", "anexo"),
        ("../", "anexo"),
        ("\x00\x01\x02", "anexo"),
    ],
)
def test_sanitize_name(raw, expected):
    assert sanitize_name(raw) == expected


def test_sanitize_long_name_keeps_the_extension_and_the_limit():
    name = sanitize_name("a" * 400 + ".pdf")
    assert len(name) == 255
    assert name.endswith(".pdf")
    assert sanitize_name("b" * 255) == "b" * 255
    assert len(sanitize_name("b" * 256)) == 255
    assert len(sanitize_name("\U0001F600" * 300 + ".png")) == 255


def test_names_are_sanitized_in_the_response_and_headers(client, headers):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id, PDF, "../../etc/passwd.pdf").json()
    assert created["original_name"] == "passwd.pdf"

    created = upload(client, headers, transaction_id, PDF, "a\\b.pdf").json()
    assert created["original_name"] == "b.pdf"

    long_name = "x" * 400 + ".pdf"
    created = upload(client, headers, transaction_id, PDF, long_name).json()
    assert len(created["original_name"]) == 255 and created["original_name"].endswith(".pdf")


# ---------- Download ----------


def test_download_headers_and_body(client, headers):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id, PDF, "nota fiscal.pdf").json()

    resp = client.get(DOWNLOAD_URL.format(created["id"]), headers=headers)
    assert resp.status_code == 200
    assert resp.content == PDF
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == (
        "attachment; filename=\"nota fiscal.pdf\"; filename*=UTF-8''nota%20fiscal.pdf"
    )
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["cache-control"] == "private, no-store"


def test_download_text_is_always_plain_text_utf8(client, headers):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id, LATIN1_CSV, "extrato.csv").json()
    resp = client.get(DOWNLOAD_URL.format(created["id"]), headers=headers)
    assert resp.headers["content-type"] == "text/plain; charset=utf-8"
    assert resp.content == LATIN1_CSV
    assert resp.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize(
    ("filename", "content", "expected_type"),
    [("a.jpg", JPEG, "image/jpeg"), ("a.png", PNG, "image/png"), ("a.webp", WEBP, "image/webp")],
)
def test_download_image_types(client, headers, filename, content, expected_type):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id, content, filename).json()
    resp = client.get(DOWNLOAD_URL.format(created["id"]), headers=headers)
    assert resp.headers["content-type"] == expected_type
    assert resp.headers["content-disposition"].startswith("attachment;")


def test_download_with_accents_in_the_name(client, headers):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id, PDF, "relatório final; v2.pdf").json()
    resp = client.get(DOWNLOAD_URL.format(created["id"]), headers=headers)
    assert resp.headers["content-disposition"] == (
        "attachment; filename=\"relat_rio final_ v2.pdf\"; filename*=UTF-8''relat%C3%B3rio%20final%3B%20v2.pdf"
    )


def test_content_disposition_cannot_be_broken_by_quotes_or_backslashes():
    from app.routers.attachments import _content_disposition

    assert _content_disposition(r'a"b\c.pdf') == "attachment; filename=\"a_b_c.pdf\"; filename*=UTF-8''a%22b%5Cc.pdf"


def test_download_is_never_html(client, headers):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id, HTML, "pagina.txt").json()
    resp = client.get(DOWNLOAD_URL.format(created["id"]), headers=headers)
    assert resp.headers["content-type"] == "text/plain; charset=utf-8"


def test_download_when_the_file_is_missing_on_disk_is_404(client, headers, storage_dir):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id).json()
    for path in files_on_disk(storage_dir):
        path.unlink()
    resp = client.get(DOWNLOAD_URL.format(created["id"]), headers=headers)
    assert resp.status_code == 404
    assert resp.json()["code"] == "attachment_not_found"


# ---------- Lista ----------


def test_list_newest_first(client, headers):
    transaction_id = make_transaction(client, headers)
    first = upload(client, headers, transaction_id, PDF, "primeiro.pdf").json()
    second = upload(client, headers, transaction_id, TEXT, "segundo.txt").json()

    resp = client.get(f"{TX_URL}/{transaction_id}/attachments", headers=headers)
    assert resp.status_code == 200
    assert [item["id"] for item in resp.json()] == [second["id"], first["id"]]
    assert set(resp.json()[0]) == {"id", "transaction_id", "original_name", "content_type", "size_bytes", "created_at"}


def test_list_is_empty_without_attachments(client, headers):
    transaction_id = make_transaction(client, headers)
    assert client.get(f"{TX_URL}/{transaction_id}/attachments", headers=headers).json() == []


def test_list_only_has_attachments_of_that_transaction(client, headers):
    first_tx = make_transaction(client, headers)
    second_tx = make_transaction(client, headers, description="Outra")
    upload(client, headers, first_tx, PDF, "a.pdf")
    upload(client, headers, second_tx, PDF, "b.pdf")
    names = [item["original_name"] for item in client.get(f"{TX_URL}/{first_tx}/attachments", headers=headers).json()]
    assert names == ["a.pdf"]


# ---------- Isolamento entre usuarios ----------


def test_another_users_resources_are_404_on_every_endpoint(client, headers, db_session, storage_dir):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id).json()
    other = other_user_headers(client, db_session)

    resp = upload(client, other, transaction_id, TEXT, "invasor.txt")
    assert resp.status_code == 404
    assert resp.json()["code"] == "transaction_not_found"

    resp = client.get(f"{TX_URL}/{transaction_id}/attachments", headers=other)
    assert resp.status_code == 404
    assert resp.json()["code"] == "transaction_not_found"

    resp = client.get(DOWNLOAD_URL.format(created["id"]), headers=other)
    assert resp.status_code == 404
    assert resp.json()["code"] == "attachment_not_found"

    resp = client.delete(DELETE_URL.format(created["id"]), headers=other)
    assert resp.status_code == 404
    assert resp.json()["code"] == "attachment_not_found"

    # Nada mudou para o dono
    assert len(files_on_disk(storage_dir)) == 1
    assert client.get(DOWNLOAD_URL.format(created["id"]), headers=headers).status_code == 200
    assert client.get(f"{TX_URL}/{transaction_id}", headers=headers).json()["attachment_count"] == 1


def test_unknown_ids_are_404(client, headers):
    missing = uuid.uuid4()
    assert upload(client, headers, missing).status_code == 404
    assert client.get(f"{TX_URL}/{missing}/attachments", headers=headers).status_code == 404
    assert client.get(DOWNLOAD_URL.format(missing), headers=headers).status_code == 404
    assert client.delete(DELETE_URL.format(missing), headers=headers).status_code == 404


def test_attachments_of_two_users_go_to_separate_directories(client, headers, db_session, storage_dir):
    mine = upload(client, headers, make_transaction(client, headers)).json()
    other = other_user_headers(client, db_session)
    theirs = upload(client, other, make_transaction(client, other), TEXT, "dele.txt").json()

    directories = {path.parent.name for path in files_on_disk(storage_dir)}
    assert len(directories) == 2
    assert row_of(db_session, mine["id"]).user_id != row_of(db_session, theirs["id"]).user_id


def test_system_transactions_do_not_accept_attachments(client, headers, db_session):
    make_account(client, headers)
    opening = db_session.scalars(select(Transaction).where(Transaction.title.like("Saldo inicial%"))).first()
    assert opening is not None
    assert upload(client, headers, str(opening.id)).status_code == 404
    assert client.get(f"{TX_URL}/{opening.id}/attachments", headers=headers).status_code == 404


# ---------- Exclusao ----------


def test_delete_attachment_removes_row_and_file(client, headers, db_session, storage_dir):
    transaction_id = make_transaction(client, headers)
    created = upload(client, headers, transaction_id).json()
    assert len(files_on_disk(storage_dir)) == 1

    assert client.delete(DELETE_URL.format(created["id"]), headers=headers).status_code == 204
    assert files_on_disk(storage_dir) == []
    assert row_of(db_session, created["id"]) is None
    assert client.get(DOWNLOAD_URL.format(created["id"]), headers=headers).status_code == 404
    assert client.get(f"{TX_URL}/{transaction_id}", headers=headers).json()["attachment_count"] == 0


def test_delete_attachment_keeps_the_others(client, headers, storage_dir):
    transaction_id = make_transaction(client, headers)
    first = upload(client, headers, transaction_id, PDF, "a.pdf").json()
    second = upload(client, headers, transaction_id, PDF, "b.pdf").json()
    client.delete(DELETE_URL.format(first["id"]), headers=headers)
    assert len(files_on_disk(storage_dir)) == 1
    assert client.get(DOWNLOAD_URL.format(second["id"]), headers=headers).status_code == 200


def test_delete_transaction_removes_every_attachment_file(client, headers, db_session, storage_dir):
    transaction_id = make_transaction(client, headers)
    other_transaction = make_transaction(client, headers, description="Outra")
    for index in range(3):
        upload(client, headers, transaction_id, TEXT, f"n{index}.txt")
    survivor = upload(client, headers, other_transaction, PDF, "fica.pdf").json()
    assert len(files_on_disk(storage_dir)) == 4

    assert client.delete(f"{TX_URL}/{transaction_id}", headers=headers).status_code == 204

    remaining = files_on_disk(storage_dir)
    assert len(remaining) == 1
    db_session.expire_all()
    assert db_session.scalar(select(Attachment).where(Attachment.transaction_id == uuid.UUID(transaction_id))) is None
    assert row_of(db_session, survivor["id"]).storage_name == remaining[0].name


def test_failure_to_delete_a_file_does_not_break_the_request(client, headers, db_session, storage_dir, monkeypatch, caplog):
    transaction_id = make_transaction(client, headers)
    upload(client, headers, transaction_id)

    def broken_unlink(self, missing_ok=False):
        raise PermissionError("sem permissao")

    monkeypatch.setattr(Path, "unlink", broken_unlink)
    with caplog.at_level("ERROR", logger="finance-app"):
        resp = client.delete(f"{TX_URL}/{transaction_id}", headers=headers)
    assert resp.status_code == 204
    assert "Nao foi possivel apagar o anexo" in caplog.text
    db_session.expire_all()
    assert db_session.scalar(select(Attachment.id)) is None


def test_files_are_kept_when_the_database_delete_fails(client, headers, storage_dir, monkeypatch):
    transaction_id = make_transaction(client, headers)
    upload(client, headers, transaction_id)

    from app.services import transactions as transactions_service

    def failing_flush(db, transaction):
        raise RuntimeError("falha no banco")

    monkeypatch.setattr(transactions_service, "delete_transaction", failing_flush)
    with TestClient(app, raise_server_exceptions=False) as local:
        resp = local.delete(f"{TX_URL}/{transaction_id}", headers=headers)
    assert resp.status_code == 500
    assert len(files_on_disk(storage_dir)) == 1


# ---------- Editar o lancamento preserva os anexos ----------


def test_put_keeps_the_attachments(client, headers, storage_dir):
    account_id = make_account(client, headers)
    transaction_id = make_transaction(client, headers, account_id)
    created = upload(client, headers, transaction_id, PDF, "nota.pdf").json()
    upload(client, headers, transaction_id, TEXT, "obs.txt")

    resp = client.put(
        f"{TX_URL}/{transaction_id}",
        json={"title": "Editado", "splits": [withdrawal(account_id, amount="80.00")]},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["attachment_count"] == 2
    assert len(files_on_disk(storage_dir)) == 2
    assert client.get(DOWNLOAD_URL.format(created["id"]), headers=headers).content == PDF
    assert len(client.get(f"{TX_URL}/{transaction_id}/attachments", headers=headers).json()) == 2


def test_failed_put_keeps_the_attachments_too(client, headers, storage_dir):
    account_id = make_account(client, headers)
    transaction_id = make_transaction(client, headers, account_id)
    upload(client, headers, transaction_id)
    resp = client.put(
        f"{TX_URL}/{transaction_id}",
        json={"splits": [withdrawal(str(uuid.uuid4()))]},
        headers=headers,
    )
    assert resp.status_code == 404
    assert client.get(f"{TX_URL}/{transaction_id}", headers=headers).json()["attachment_count"] == 1
    assert len(files_on_disk(storage_dir)) == 1


# ---------- attachment_count ----------


def test_attachment_count_in_every_transaction_output(client, headers):
    account_id = make_account(client, headers)
    with_files = make_transaction(client, headers, account_id)
    without = make_transaction(client, headers, account_id, description="Sem anexo")
    upload(client, headers, with_files, PDF, "a.pdf")
    upload(client, headers, with_files, PDF, "b.pdf")

    assert client.get(f"{TX_URL}/{with_files}", headers=headers).json()["attachment_count"] == 2
    assert client.get(f"{TX_URL}/{without}", headers=headers).json()["attachment_count"] == 0
    counts = {item["id"]: item["attachment_count"] for item in client.get(TX_URL, headers=headers).json()["items"]}
    assert counts == {with_files: 2, without: 0}


def test_attachment_count_only_counts_the_own_transaction(client, headers, db_session):
    first = make_transaction(client, headers)
    second = make_transaction(client, headers, description="Outra")
    other = other_user_headers(client, db_session)
    upload(client, other, make_transaction(client, other), PDF, "dele.pdf")
    upload(client, headers, first)
    counts = {item["id"]: item["attachment_count"] for item in client.get(TX_URL, headers=headers).json()["items"]}
    assert counts == {first: 1, second: 0}


def test_new_transaction_starts_with_zero_attachments(client, headers):
    account_id = make_account(client, headers)
    resp = client.post(TX_URL, json={"splits": [withdrawal(account_id)]}, headers=headers)
    assert resp.json()["attachment_count"] == 0


def count_queries(action) -> int:
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        action()
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(statements)


def test_listing_with_attachments_does_not_run_a_query_per_transaction(client, headers):
    account_id = make_account(client, headers)
    first = make_transaction(client, headers, account_id, description="Primeira")
    upload(client, headers, first)
    few = count_queries(lambda: client.get(TX_URL, headers=headers))

    for index in range(8):
        transaction_id = make_transaction(
            client, headers, account_id, description=f"Compra {index}", counterparty_name=f"Loja {index}"
        )
        upload(client, headers, transaction_id, TEXT, f"n{index}.txt")
        upload(client, headers, transaction_id, PDF, f"p{index}.pdf")
    many = count_queries(lambda: client.get(TX_URL, headers=headers))

    assert client.get(TX_URL, headers=headers).json()["total"] == 9
    assert many == few

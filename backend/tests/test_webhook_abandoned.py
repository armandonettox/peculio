"""Entrega que derruba o processo varias vezes seguidas e proxy do ambiente.

Sem limite, um aviso que mata o processo sempre no mesmo ponto seria reenviado a cada LEASE para
sempre. O contador `claims` conta reivindicacoes sem resultado gravado; passando de
MAX_LOST_CLAIMS a entrega e abandonada (falha final, com o motivo no historico)."""

import threading
import uuid
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.webhook import DeliveryStatus, Webhook, WebhookDelivery
from app.services import webhook_delivery as delivery_service
from tests.test_webhook_delivery import (  # noqa: F401
    NOW,
    account_id,
    create_tx,
    headers,
    make_webhook,
    only_delivery,
    pending_one,
    run_now,
)
from tests.webhook_support import no_real_dns, server  # noqa: F401

LEASE = delivery_service.LEASE
MAX_LOST = delivery_service.MAX_LOST_CLAIMS
STEP = LEASE + timedelta(seconds=1)


class SimulatedCrash(BaseException):
    """O processo morreu no meio do POST."""


def crash_once(db_session, server, when):
    def dies(request):
        raise SimulatedCrash()

    server.handler = dies
    with pytest.raises(SimulatedCrash):
        run_now(db_session, when)
    db_session.rollback()


def set_claims(db_session, delivery_id, value):
    delivery = db_session.get(WebhookDelivery, delivery_id)
    delivery.claims = value
    db_session.commit()


# ---------- O contador ----------


def test_the_limit_is_three():
    assert MAX_LOST == 3


def test_a_new_delivery_starts_with_no_lost_claims(client, headers, account_id, db_session):
    pending_one(client, headers, account_id)
    assert only_delivery(db_session).claims == 0


def test_each_crash_counts_one_lost_claim_and_no_attempt(client, headers, account_id, db_session, server):
    pending_one(client, headers, account_id)
    when = NOW
    for expected in (1, 2):
        crash_once(db_session, server, when)
        delivery = only_delivery(db_session)
        assert (delivery.claims, delivery.attempts, delivery.status) == (expected, 0, DeliveryStatus.pending)
        when += STEP


def test_after_the_third_crash_the_next_round_abandons_without_sending(client, headers, account_id, db_session, server):
    pending_one(client, headers, account_id)
    when = NOW
    for _ in range(MAX_LOST):
        crash_once(db_session, server, when)
        when += STEP
    assert only_delivery(db_session).claims == MAX_LOST
    sent_before = len(server.requests)

    server.handler = lambda request: httpx.Response(200)
    assert run_now(db_session, when) is True

    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.failed
    assert delivery.finished_at is not None
    assert delivery.next_attempt_at is None
    assert delivery.attempts == 0
    assert delivery.last_error == f"Entrega abandonada: o processo parou no meio do envio {MAX_LOST} vezes seguidas"
    # Nada foi enviado na rodada que abandonou
    assert len(server.requests) == sent_before
    # E a fila ficou vazia
    assert run_now(db_session, when + STEP) is False


def test_two_crashes_are_tolerated_and_the_third_claim_still_sends(client, headers, account_id, db_session, server):
    pending_one(client, headers, account_id)
    when = NOW
    for _ in range(MAX_LOST - 1):
        crash_once(db_session, server, when)
        when += STEP
    server.handler = lambda request: httpx.Response(200)
    assert run_now(db_session, when) is True
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.delivered
    assert delivery.claims == 0


@pytest.mark.parametrize(("claims", "abandoned"), [(0, False), (1, False), (MAX_LOST - 1, False), (MAX_LOST, True), (MAX_LOST + 5, True)])
def test_the_boundary_is_exactly_at_the_limit(client, headers, account_id, db_session, server, claims, abandoned):
    pending_one(client, headers, account_id)
    set_claims(db_session, only_delivery(db_session).id, claims)
    server.handler = lambda request: httpx.Response(200)
    run_now(db_session, NOW)
    delivery = only_delivery(db_session)
    assert (delivery.status == DeliveryStatus.failed) is abandoned
    assert (len(server.requests) == 0) is abandoned


# ---------- Um resultado gravado reinicia a conta ----------


def test_a_recorded_failure_resets_the_counter_so_only_consecutive_crashes_count(
    client, headers, account_id, db_session, server
):
    pending_one(client, headers, account_id)
    when = NOW
    crash_once(db_session, server, when)
    when += STEP
    crash_once(db_session, server, when)
    when += STEP
    assert only_delivery(db_session).claims == 2

    # Uma resposta 500 e um resultado: a tentativa conta e a conta de perdas volta a zero
    server.handler = lambda request: httpx.Response(500)
    run_now(db_session, when)
    delivery = only_delivery(db_session)
    assert (delivery.claims, delivery.attempts, delivery.status) == (0, 1, DeliveryStatus.pending)

    # Mais dois quedas nao abandonam: nao sao tres seguidas
    when = delivery.next_attempt_at + timedelta(seconds=1)
    crash_once(db_session, server, when)
    when += STEP
    crash_once(db_session, server, when)
    assert only_delivery(db_session).status == DeliveryStatus.pending
    assert only_delivery(db_session).claims == 2


def test_a_successful_delivery_after_crashes_ends_with_zero_lost_claims(client, headers, account_id, db_session, server):
    pending_one(client, headers, account_id)
    crash_once(db_session, server, NOW)
    server.handler = lambda request: httpx.Response(200)
    run_now(db_session, NOW + STEP)
    delivery = only_delivery(db_session)
    assert (delivery.status, delivery.claims) == (DeliveryStatus.delivered, 0)


def test_a_discarded_result_does_not_reset_the_counter(client, headers, account_id, db_session):
    """O worker lento perdeu o lease: o resultado dele e descartado e nao apaga a conta de quem o tomou."""
    pending_one(client, headers, account_id)
    slow = delivery_service.claim_next(db_session, NOW)
    fast = delivery_service.claim_next(db_session, NOW + STEP)
    assert only_delivery(db_session).claims == 2
    outcome = delivery_service.Outcome(True, status_code=200)
    assert delivery_service.finish_attempt(db_session, slow, outcome, NOW + STEP) is False
    assert only_delivery(db_session).claims == 2
    assert delivery_service.finish_attempt(db_session, fast, outcome, NOW + STEP) is True
    assert only_delivery(db_session).claims == 0


def test_one_deliverys_crashes_do_not_affect_another(client, headers, account_id, db_session, server):
    pending_one(client, headers, account_id)
    other = create_tx(client, headers, account_id, description="Outra compra")
    deliveries = db_session.execute(select(WebhookDelivery).order_by(WebhookDelivery.created_at)).scalars().all()
    assert len(deliveries) == 2
    first, second = deliveries
    set_claims(db_session, first.id, MAX_LOST)
    server.handler = lambda request: httpx.Response(200)
    run_now(db_session, NOW)
    run_now(db_session, NOW)
    db_session.expire_all()
    assert db_session.get(WebhookDelivery, first.id).status == DeliveryStatus.failed
    assert db_session.get(WebhookDelivery, second.id).status == DeliveryStatus.delivered
    assert other["id"]


# ---------- Precedencia e historico ----------


def test_a_paused_webhook_expires_the_delivery_even_if_it_had_lost_claims(client, headers, account_id, db_session, server):
    pending_one(client, headers, account_id)
    set_claims(db_session, only_delivery(db_session).id, MAX_LOST)
    webhook = db_session.execute(select(Webhook)).scalar_one()
    webhook.active = False
    db_session.commit()
    server.handler = lambda request: httpx.Response(200)
    run_now(db_session, NOW)
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.expired
    assert delivery.last_error == delivery_service.PAUSED_REASON


def test_the_abandoned_delivery_shows_up_in_the_history_with_the_reason(client, headers, account_id, db_session, server):
    webhook = pending_one(client, headers, account_id)
    set_claims(db_session, only_delivery(db_session).id, MAX_LOST)
    run_now(db_session, NOW)
    response = client.get(f"/api/v1/webhooks/{webhook['id']}/deliveries", headers=headers)
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["status"] == "failed"
    assert "Entrega abandonada" in item["last_error"]


def test_the_abandoned_delivery_is_cleaned_up_by_the_retention_like_any_finished_one(
    client, headers, account_id, db_session, server
):
    pending_one(client, headers, account_id)
    set_claims(db_session, only_delivery(db_session).id, MAX_LOST)
    run_now(db_session, NOW)
    removed = delivery_service.purge_finished(db_session, now=NOW + timedelta(days=settings.webhook_delivery_retention_days + 1))
    assert removed == 1
    assert db_session.execute(select(WebhookDelivery)).scalars().all() == []


# ---------- Proxy do ambiente ----------


class _Recorder(BaseHTTPRequestHandler):
    seen: list[str] = []

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)
        type(self).seen.append(self.path)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


def test_environment_proxies_are_ignored_so_the_validated_ip_is_always_the_one_used(
    client, headers, account_id, db_session, monkeypatch
):
    """Com um proxy no ambiente, quem resolveria o nome seria o proxy e o pino do IP nao valeria.
    O cliente de webhooks nao usa proxy do ambiente: a entrega vai direto, mesmo com um proxy morto."""
    monkeypatch.setattr(settings, "webhook_allow_private", True)
    _Recorder.seen = []
    receiver = HTTPServer(("127.0.0.1", 0), _Recorder)
    thread = threading.Thread(target=receiver.serve_forever, daemon=True)
    thread.start()
    try:
        port = receiver.server_address[1]
        hook = make_webhook(client, headers, url=f"http://127.0.0.1:{port}/hook")
        webhook = db_session.get(Webhook, uuid.UUID(hook["id"]))
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            monkeypatch.setenv(name, "http://127.0.0.1:9")
        monkeypatch.setattr(delivery_service, "client_factory", delivery_service.make_client)

        outcome = delivery_service.post_webhook(
            webhook.url, webhook.secret_encrypted, uuid.uuid4(), "webhook.test", {"ok": True}, NOW
        )
    finally:
        receiver.shutdown()
        receiver.server_close()

    assert outcome.ok is True, outcome.error
    assert _Recorder.seen == ["/hook"]


def test_the_client_mounts_no_environment_proxy(monkeypatch):
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        monkeypatch.setenv(name, "http://127.0.0.1:9")
    assert delivery_service.make_client()._mounts == {}
    # Para comparar: um cliente comum do httpx monta o proxy do ambiente
    assert httpx.Client()._mounts != {}

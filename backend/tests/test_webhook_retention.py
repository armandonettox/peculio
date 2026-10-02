"""Retencao do historico de entregas: so entrega FINALIZADA e velha e apagada, nunca pendente."""

import asyncio
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.exc import OperationalError

from app.core import scheduler
from app.core.config import Settings
from app.core.database import SessionLocal
from app.core.two_factor import encrypt_secret
from app.models.webhook import DeliveryStatus, Webhook, WebhookDelivery
from app.services import webhook_delivery as delivery_service
from tests.conftest import make_user
from tests.webhook_support import no_real_dns, server  # noqa: F401

NOW = datetime(2040, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
DAYS = 30
OLD = NOW - timedelta(days=DAYS, hours=1)
RECENT = NOW - timedelta(days=DAYS - 1)
FINAL = [DeliveryStatus.delivered, DeliveryStatus.failed, DeliveryStatus.expired]


@pytest.fixture
def webhook(db_session):
    user = make_user(db_session)
    hook = Webhook(
        user_id=user.id,
        name="Teste",
        url="https://hooks.example.com/x",
        secret_encrypted=encrypt_secret("segredo"),
        events=["transaction.created"],
    )
    db_session.add(hook)
    db_session.commit()
    return hook


def add_delivery(db_session, webhook, status, finished_at, created_at=None):
    row = WebhookDelivery(
        webhook_id=webhook.id,
        user_id=webhook.user_id,
        event="transaction.created",
        payload={"event": "transaction.created"},
        status=status,
        next_attempt_at=NOW if status == DeliveryStatus.pending else None,
        finished_at=finished_at,
        created_at=created_at or finished_at or OLD,
    )
    db_session.add(row)
    db_session.commit()
    return row.id


def remaining(db_session):
    db_session.expire_all()
    return {row.id: row.status for row in db_session.execute(select(WebhookDelivery)).scalars()}


def purge(db_session, **kwargs):
    return delivery_service.purge_finished(db_session, now=NOW, retention_days=DAYS, **kwargs)


# ---------- Configuracao ----------


def test_default_retention_is_30_days():
    assert Settings(_env_file=None).webhook_delivery_retention_days == 30


def test_retention_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("WEBHOOK_DELIVERY_RETENTION_DAYS", "7")
    assert Settings(_env_file=None).webhook_delivery_retention_days == 7


@pytest.mark.parametrize("value", [0, -5])
def test_retention_must_be_at_least_one_day(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, webhook_delivery_retention_days=value)


def test_env_example_documents_the_setting():
    example = Path(__file__).resolve().parents[2] / ".env.example"
    assert "WEBHOOK_DELIVERY_RETENTION_DAYS=30" in example.read_text(encoding="utf-8")


# ---------- O que apaga e o que nunca apaga ----------


@pytest.mark.parametrize("status", FINAL)
def test_old_finished_deliveries_are_removed(db_session, webhook, status):
    add_delivery(db_session, webhook, status, OLD)
    assert purge(db_session) == 1
    assert remaining(db_session) == {}


@pytest.mark.parametrize("status", FINAL)
def test_recent_finished_deliveries_are_kept(db_session, webhook, status):
    kept = add_delivery(db_session, webhook, status, RECENT)
    assert purge(db_session) == 0
    assert remaining(db_session) == {kept: status}


def test_the_deadline_is_exclusive_at_the_exact_cutoff(db_session, webhook):
    exact = add_delivery(db_session, webhook, DeliveryStatus.delivered, NOW - timedelta(days=DAYS))
    just_over = add_delivery(
        db_session, webhook, DeliveryStatus.delivered, NOW - timedelta(days=DAYS, microseconds=1)
    )
    assert purge(db_session) == 1
    assert set(remaining(db_session)) == {exact}
    assert just_over not in remaining(db_session)


def test_a_pending_delivery_is_never_removed_however_old(db_session, webhook):
    ancient = datetime(2001, 1, 1, tzinfo=timezone.utc)
    pending = add_delivery(db_session, webhook, DeliveryStatus.pending, None, created_at=ancient)
    # Mesmo que alguem tenha deixado finished_at preenchido numa pendente, ela fica
    odd = add_delivery(db_session, webhook, DeliveryStatus.pending, ancient, created_at=ancient)
    assert purge(db_session) == 0
    assert remaining(db_session) == {pending: DeliveryStatus.pending, odd: DeliveryStatus.pending}


def test_age_counts_from_when_it_finished_not_from_when_it_was_created(db_session, webhook):
    # Criada ha muito tempo, mas expirou agora (ex: webhook pausado hoje): ainda nao passou o prazo
    kept = add_delivery(db_session, webhook, DeliveryStatus.expired, RECENT, created_at=OLD - timedelta(days=90))
    assert purge(db_session) == 0
    assert set(remaining(db_session)) == {kept}


def test_mixed_table_removes_only_the_old_finished_ones(db_session, webhook):
    gone = [add_delivery(db_session, webhook, status, OLD) for status in FINAL]
    kept = {
        add_delivery(db_session, webhook, DeliveryStatus.pending, None, created_at=OLD): DeliveryStatus.pending,
        add_delivery(db_session, webhook, DeliveryStatus.delivered, RECENT): DeliveryStatus.delivered,
    }
    assert purge(db_session) == 3
    left = remaining(db_session)
    assert left == kept
    assert not set(gone) & set(left)


def test_retention_days_argument_changes_the_deadline(db_session, webhook):
    add_delivery(db_session, webhook, DeliveryStatus.delivered, NOW - timedelta(days=10))
    assert delivery_service.purge_finished(db_session, now=NOW, retention_days=30) == 0
    assert delivery_service.purge_finished(db_session, now=NOW, retention_days=7) == 1


def test_default_deadline_comes_from_the_setting(db_session, webhook, monkeypatch):
    monkeypatch.setattr(delivery_service.settings, "webhook_delivery_retention_days", 3)
    add_delivery(db_session, webhook, DeliveryStatus.delivered, NOW - timedelta(days=4))
    assert delivery_service.purge_finished(db_session, now=NOW) == 1


def test_other_tables_are_untouched(db_session, webhook):
    add_delivery(db_session, webhook, DeliveryStatus.delivered, OLD)
    purge(db_session)
    db_session.expire_all()
    assert db_session.get(Webhook, webhook.id) is not None


# ---------- Lotes, idempotencia e duas instancias ----------


def test_removes_in_batches_until_nothing_is_left(db_session, webhook):
    for _ in range(7):
        add_delivery(db_session, webhook, DeliveryStatus.failed, OLD)
    keep = add_delivery(db_session, webhook, DeliveryStatus.failed, RECENT)
    assert purge(db_session, batch_size=3) == 7
    assert set(remaining(db_session)) == {keep}


def test_each_batch_is_committed_on_its_own(db_session, webhook, monkeypatch):
    for _ in range(5):
        add_delivery(db_session, webhook, DeliveryStatus.delivered, OLD)
    commits = []
    original = db_session.commit

    def spy():
        commits.append(1)
        original()

    monkeypatch.setattr(db_session, "commit", spy)
    assert purge(db_session, batch_size=2) == 5
    # 3 lotes (2 + 2 + 1); um lote cheio e seguido de outra consulta
    assert len(commits) == 3


def test_exact_multiple_of_the_batch_size_ends_cleanly(db_session, webhook):
    for _ in range(4):
        add_delivery(db_session, webhook, DeliveryStatus.delivered, OLD)
    assert purge(db_session, batch_size=2) == 4
    assert remaining(db_session) == {}


def test_running_again_is_harmless(db_session, webhook):
    add_delivery(db_session, webhook, DeliveryStatus.delivered, OLD)
    keep = add_delivery(db_session, webhook, DeliveryStatus.pending, None)
    assert purge(db_session) == 1
    assert purge(db_session) == 0
    assert purge(db_session) == 0
    assert set(remaining(db_session)) == {keep}


def test_rows_locked_by_another_instance_are_skipped_not_waited_for(db_session, webhook):
    locked = add_delivery(db_session, webhook, DeliveryStatus.delivered, OLD)
    free = add_delivery(db_session, webhook, DeliveryStatus.delivered, OLD)
    with SessionLocal() as other:
        other.execute(select(WebhookDelivery).where(WebhookDelivery.id == locked).with_for_update())
        db_session.execute(text("SET lock_timeout = '500ms'"))
        try:
            assert purge(db_session) == 1
        except OperationalError:
            pytest.fail("a limpeza esperou por uma linha travada em vez de pula-la")
        assert set(remaining(db_session)) == {locked}
        assert free not in remaining(db_session)
    db_session.execute(text("RESET lock_timeout"))
    # Quando a outra instancia solta a linha, a proxima rodada limpa o resto
    assert purge(db_session) == 1
    assert remaining(db_session) == {}


def test_two_instances_purging_together_remove_each_row_exactly_once(db_session, webhook):
    for _ in range(40):
        add_delivery(db_session, webhook, DeliveryStatus.delivered, OLD)
    keep = add_delivery(db_session, webhook, DeliveryStatus.pending, None)
    totals = []
    errors = []

    def worker():
        try:
            with SessionLocal() as session:
                totals.append(delivery_service.purge_finished(session, now=NOW, retention_days=DAYS, batch_size=5))
        except Exception as error:  # noqa: BLE001
            errors.append(error)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert errors == []
    # Lotes pulam o que o outro trava, entao o total das duas e exatamente 40
    leftover = purge(db_session)
    assert sum(totals) + leftover == 40
    assert set(remaining(db_session)) == {keep}


def test_rejects_a_non_positive_batch_size(db_session):
    with pytest.raises(ValueError):
        delivery_service.purge_finished(db_session, now=NOW, retention_days=DAYS, batch_size=0)


def test_rejects_a_non_positive_retention(db_session):
    with pytest.raises(ValueError):
        delivery_service.purge_finished(db_session, now=NOW, retention_days=0)


# ---------- finished_at e os caminhos que finalizam ----------


def test_delivered_and_failed_attempts_set_finished_at():
    delivered = WebhookDelivery(status=DeliveryStatus.pending, attempts=0)
    delivery_service.apply_outcome(delivered, delivery_service.Outcome(True, status_code=200), NOW)
    assert delivered.finished_at == NOW

    retrying = WebhookDelivery(status=DeliveryStatus.pending, attempts=0)
    delivery_service.apply_outcome(retrying, delivery_service.Outcome(False, error="x"), NOW)
    assert retrying.status == DeliveryStatus.pending
    assert retrying.finished_at is None

    last = WebhookDelivery(status=DeliveryStatus.pending, attempts=delivery_service.MAX_ATTEMPTS - 1)
    delivery_service.apply_outcome(last, delivery_service.Outcome(False, error="x"), NOW)
    assert last.status == DeliveryStatus.failed
    assert last.finished_at == NOW


def test_expiring_sets_finished_at():
    row = WebhookDelivery(status=DeliveryStatus.pending, attempts=0)
    delivery_service.expire_delivery(row, "motivo", NOW)
    assert row.status == DeliveryStatus.expired
    assert row.finished_at == NOW


def test_the_test_button_deliveries_get_finished_at_too(db_session, webhook, server):
    import httpx

    ok = delivery_service.send_test(db_session, webhook)
    assert ok.status == DeliveryStatus.delivered
    assert ok.finished_at is not None
    server.handler = lambda request: httpx.Response(500)
    bad = delivery_service.send_test(db_session, webhook)
    assert bad.status == DeliveryStatus.failed
    assert bad.finished_at is not None


def test_the_paused_expiry_paths_set_finished_at(db_session, webhook):
    from app.services import webhooks as webhook_service

    # Caminho da pausa pela API (em lote)
    bulk = add_delivery(db_session, webhook, DeliveryStatus.pending, None)
    assert webhook_service.expire_pending(db_session, webhook.id) == 1
    db_session.commit()
    db_session.expire_all()
    row = db_session.get(WebhookDelivery, bulk)
    assert row.status == DeliveryStatus.expired
    assert abs(row.finished_at - datetime.now(timezone.utc)) < timedelta(minutes=1)

    # Caminho da rede de seguranca na hora de entregar
    webhook.active = False
    straggler = add_delivery(db_session, webhook, DeliveryStatus.pending, None)
    db_session.commit()
    assert delivery_service.deliver_next(db_session, now=NOW) is True
    db_session.expire_all()
    assert db_session.get(WebhookDelivery, straggler).finished_at == NOW


def test_migration_backfills_finished_at_for_existing_rows(clean_schema):
    from alembic import command

    from app.core.database import engine
    from tests.conftest import alembic_config

    config = alembic_config()
    command.upgrade(config, "0014")
    user_id = uuid.uuid4()
    hook_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO users (id, name, email, hashed_password) VALUES (:i, 'Ana', 'ana@example.com', 'x')"),
            {"i": user_id},
        )
        conn.execute(
            text(
                "INSERT INTO webhooks (id, user_id, name, url, secret_encrypted, events) "
                "VALUES (:w, :u, 'h', 'https://hooks.example.com/x', 's', ARRAY['transaction.created'])"
            ),
            {"w": hook_id, "u": user_id},
        )
        for status, delivered_at, last_attempt_at, created_at in [
            ("delivered", "2030-01-03", "2030-01-02", "2030-01-01"),
            ("failed", None, "2030-01-02", "2030-01-01"),
            ("failed", None, None, "2030-01-01"),
            ("pending", None, None, "2030-01-01"),
        ]:
            conn.execute(
                text(
                    "INSERT INTO webhook_deliveries (id, webhook_id, user_id, event, payload, status, "
                    "delivered_at, last_attempt_at, created_at) "
                    "VALUES (:i, :w, :u, 'transaction.created', '{}', :s, :d, :l, :c)"
                ),
                {"i": uuid.uuid4(), "w": hook_id, "u": user_id, "s": status, "d": delivered_at, "l": last_attempt_at, "c": created_at},
            )
    command.upgrade(config, "head")
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT status, finished_at::date::text, delivered_at IS NOT NULL FROM webhook_deliveries ORDER BY status, created_at, last_attempt_at NULLS LAST")
        ).all()
    by_key = [(r[0], r[1]) for r in rows]
    assert ("delivered", "2030-01-03") in by_key
    assert ("failed", "2030-01-02") in by_key
    assert ("failed", "2030-01-01") in by_key
    assert ("pending", None) in by_key


# ---------- Laco de fundo ----------


def test_one_cleanup_round_uses_the_configured_retention(db_session, webhook, monkeypatch):
    monkeypatch.setattr(delivery_service.settings, "webhook_delivery_retention_days", 30)
    real_now = datetime.now(timezone.utc)
    add_delivery(db_session, webhook, DeliveryStatus.delivered, real_now - timedelta(days=31))
    keep = add_delivery(db_session, webhook, DeliveryStatus.delivered, real_now - timedelta(days=29))
    assert scheduler.run_webhook_cleanup_once() == 1
    assert scheduler.run_webhook_cleanup_once() == 0
    assert set(remaining(db_session)) == {keep}


def test_the_cleanup_loop_keeps_going_after_a_round_fails(monkeypatch):
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("banco indisponivel")
        return 0

    monkeypatch.setattr(scheduler, "run_webhook_cleanup_once", flaky)

    async def run():
        task = asyncio.create_task(scheduler.webhook_cleanup_loop(0))
        for _ in range(100):
            if len(calls) >= 3:
                break
            await asyncio.sleep(0.01)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(run())
    assert len(calls) >= 3


def test_the_cleanup_loop_is_part_of_the_scheduler(monkeypatch):
    started = []

    def fake(name):
        async def loop(interval):
            started.append((name, interval))

        return loop

    monkeypatch.setattr(scheduler, "recurrence_loop", fake("recurrence"))
    monkeypatch.setattr(scheduler, "webhook_loop", fake("webhook"))
    monkeypatch.setattr(scheduler, "webhook_cleanup_loop", fake("cleanup"))
    asyncio.run(scheduler._run_loops())
    names = {name for name, _ in started}
    assert names == {"recurrence", "webhook", "cleanup"}
    interval = dict(started)["cleanup"]
    assert interval == scheduler.settings.webhook_cleanup_interval_seconds
    assert interval >= 60


def test_count_of_rows_matches_what_the_purge_reports(db_session, webhook):
    for _ in range(3):
        add_delivery(db_session, webhook, DeliveryStatus.delivered, OLD)
    before = db_session.scalar(select(func.count()).select_from(WebhookDelivery))
    removed = purge(db_session)
    after = db_session.scalar(select(func.count()).select_from(WebhookDelivery))
    assert before - after == removed == 3

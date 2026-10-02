import hashlib
import hmac
import json
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.two_factor import decrypt_secret
from app.core.webhook_url import Resolver, WebhookUrlError, validate_webhook_url
from app.models.webhook import TEST_EVENT, DeliveryStatus, Webhook, WebhookDelivery

logger = logging.getLogger("finance-app.webhooks")

TIMEOUT_SECONDS = 10
MAX_ATTEMPTS = 5
# Espera depois da 1a, 2a, 3a e 4a falha. Na 5a falha a entrega vira "failed".
RETRY_DELAYS = (timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=30), timedelta(hours=2))
EXCERPT_CHARS = 500
# Quanto da resposta lemos antes de parar (bem acima do trecho guardado)
MAX_RESPONSE_BYTES = 4000
# Motivo gravado (e mostrado no historico) quando uma entrega expira por causa da pausa
PAUSED_REASON = "Webhook pausado: entrega expirada sem ser enviada"


def retry_delay(failed_attempts: int) -> timedelta | None:
    """Quanto esperar para a proxima tentativa depois de `failed_attempts` falhas seguidas, ou
    None quando as tentativas acabaram (a 5a falha encerra)."""
    if failed_attempts < 1:
        raise ValueError("failed_attempts precisa ser pelo menos 1")
    if failed_attempts >= MAX_ATTEMPTS:
        return None
    return RETRY_DELAYS[failed_attempts - 1]


def build_body(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign(secret: str, timestamp: int, body: bytes) -> str:
    """Assinatura enviada em X-Finance-Signature: sha256= + HMAC-SHA256(segredo, timestamp + "." + corpo).
    O timestamp entra na conta para quem recebe poder recusar requisicoes antigas (replay)."""
    message = str(timestamp).encode("ascii") + b"." + body
    return "sha256=" + hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def make_client() -> httpx.Client:
    # Sem seguir redirecionamentos: um 302 para um endereco interno furaria a checagem de SSRF
    return httpx.Client(timeout=httpx.Timeout(TIMEOUT_SECONDS), follow_redirects=False)


# Os testes trocam isto por um cliente com httpx.MockTransport (nada de rede real)
client_factory: Callable[[], httpx.Client] = make_client


@dataclass
class Outcome:
    ok: bool
    status_code: int | None = None
    error: str | None = None
    excerpt: str | None = None


def _clean(text: str, limit: int | None = None) -> str:
    # O PostgreSQL recusa o caractere NUL em texto
    text = text.replace("\x00", "")
    return text if limit is None else text[:limit]


def post_webhook(
    webhook: Webhook,
    delivery_id: uuid.UUID,
    event: str,
    payload: dict,
    now: datetime,
    resolver: Resolver | None = None,
) -> Outcome:
    """Faz o POST assinado. Nunca levanta: qualquer falha vira um Outcome com a mensagem."""
    secret = decrypt_secret(webhook.secret_encrypted)
    if secret is None:
        return Outcome(False, error="Nao foi possivel ler o segredo do webhook")
    try:
        # De novo antes de entregar: o DNS pode ter mudado desde o cadastro
        validate_webhook_url(webhook.url, resolver=resolver)
    except WebhookUrlError as error:
        return Outcome(False, error=str(error))

    body = build_body(payload)
    timestamp = int(now.timestamp())
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "finance-app-webhooks",
        "X-Finance-Event": event,
        "X-Finance-Delivery": str(delivery_id),
        "X-Finance-Timestamp": str(timestamp),
        "X-Finance-Signature": sign(secret, timestamp, body),
    }
    try:
        with client_factory() as client:
            with client.stream("POST", webhook.url, content=body, headers=headers) as response:
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    chunks.append(chunk)
                    size += len(chunk)
                    if size >= MAX_RESPONSE_BYTES:
                        break
                status_code = response.status_code
        excerpt = _clean(b"".join(chunks).decode("utf-8", errors="replace"), EXCERPT_CHARS)
    except httpx.TimeoutException:
        return Outcome(False, error=f"Tempo esgotado ({TIMEOUT_SECONDS} s) esperando a resposta")
    except httpx.HTTPError as error:
        return Outcome(False, error=f"Falha de conexao ({type(error).__name__})")
    except Exception as error:  # noqa: BLE001 - uma entrega com erro estranho nao pode derrubar o laco
        logger.warning("Erro inesperado ao entregar webhook: %s", type(error).__name__)
        return Outcome(False, error=f"Erro inesperado ({type(error).__name__})")

    if 200 <= status_code < 300:
        return Outcome(True, status_code=status_code, excerpt=excerpt)
    return Outcome(False, status_code=status_code, error=f"Resposta HTTP {status_code}", excerpt=excerpt)


def apply_outcome(delivery: WebhookDelivery, outcome: Outcome, now: datetime) -> None:
    """Registra uma tentativa: entregue, ou falha com a proxima tentativa marcada (ou encerrada)."""
    delivery.attempts += 1
    delivery.last_attempt_at = now
    delivery.last_status_code = outcome.status_code
    delivery.last_error = _clean(outcome.error) if outcome.error else None
    delivery.response_excerpt = outcome.excerpt
    if outcome.ok:
        delivery.status = DeliveryStatus.delivered
        delivery.delivered_at = now
        delivery.finished_at = now
        delivery.next_attempt_at = None
        return
    delay = retry_delay(delivery.attempts)
    if delay is None:
        delivery.status = DeliveryStatus.failed
        delivery.next_attempt_at = None
        delivery.finished_at = now
    else:
        delivery.status = DeliveryStatus.pending
        delivery.next_attempt_at = now + delay


def expire_delivery(delivery: WebhookDelivery, reason: str, now: datetime) -> None:
    """Tira a entrega da fila com um estado final proprio. Nao conta como tentativa: nada foi enviado."""
    delivery.status = DeliveryStatus.expired
    delivery.next_attempt_at = None
    delivery.last_error = reason
    delivery.finished_at = now


def deliver_next(db: Session, now: datetime | None = None, resolver: Resolver | None = None) -> bool:
    """Trata UMA pendente vencida e confirma. False se nao havia nenhuma.

    Se o webhook esta pausado, a entrega expira (estado final, motivo no historico) em vez de ser
    enviada. Reativar o webhook depois NAO reenvia o que expirou: um aviso de lancamento que chega
    dias depois, fora de ordem, faz mais mal do que bem. A reativacao vale so para eventos novos.

    O SELECT ... FOR UPDATE SKIP LOCKED faz dois processos (ou duas rodadas) nunca pegarem a mesma
    entrega: quem chega depois pula a linha travada. O lock fica ate o commit, durante o POST."""
    now = now or datetime.now(timezone.utc)
    row = db.execute(
        select(WebhookDelivery, Webhook.active)
        .join(Webhook, Webhook.id == WebhookDelivery.webhook_id)
        .where(
            WebhookDelivery.status == DeliveryStatus.pending,
            WebhookDelivery.next_attempt_at <= now,
        )
        .order_by(WebhookDelivery.next_attempt_at, WebhookDelivery.id)
        .limit(1)
        .with_for_update(of=WebhookDelivery, skip_locked=True)
    ).first()
    if row is None:
        db.rollback()
        return False
    delivery, webhook_active = row
    if not webhook_active:
        expire_delivery(delivery, PAUSED_REASON, now)
        db.commit()
        return True
    webhook = db.get(Webhook, delivery.webhook_id)
    outcome = post_webhook(webhook, delivery.id, delivery.event, delivery.payload, now, resolver)
    apply_outcome(delivery, outcome, now)
    db.commit()
    return True


def run_due(db: Session, limit: int = 100, resolver: Resolver | None = None) -> int:
    """Uma rodada do laco: entrega as pendentes vencidas, uma por vez. Devolve quantas tentou."""
    done = 0
    while done < limit and deliver_next(db, resolver=resolver):
        done += 1
    return done


FINAL_STATUSES = (DeliveryStatus.delivered, DeliveryStatus.failed, DeliveryStatus.expired)
PURGE_BATCH_SIZE = 500


def purge_finished(
    db: Session,
    now: datetime | None = None,
    retention_days: int | None = None,
    batch_size: int = PURGE_BATCH_SIZE,
) -> int:
    """Apaga o historico de entregas FINALIZADAS (entregue, falhou de vez, expirada) cujo
    finished_at passou do prazo de retencao. Entrega pendente nunca e apagada, por mais velha que seja.

    Apaga em lotes, um commit por lote, para nao segurar lock nem inchar a transacao. O lote escolhe
    as linhas com FOR UPDATE SKIP LOCKED: duas instancias rodando juntas nunca esperam uma pela outra
    e nunca apagam a mesma linha (quem chega depois pula o que o outro ja travou; o que sobrar
    sai na proxima rodada). Rodar de novo e inofensivo. Devolve quantas linhas apagou."""
    if retention_days is None:
        retention_days = settings.webhook_delivery_retention_days
    if retention_days < 1:
        raise ValueError("retention_days precisa ser pelo menos 1")
    if batch_size < 1:
        raise ValueError("batch_size precisa ser pelo menos 1")
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=retention_days)
    total = 0
    while True:
        batch = (
            select(WebhookDelivery.id)
            .where(WebhookDelivery.status.in_(FINAL_STATUSES), WebhookDelivery.finished_at < cutoff)
            .order_by(WebhookDelivery.finished_at, WebhookDelivery.id)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
            .scalar_subquery()
        )
        removed = db.execute(delete(WebhookDelivery).where(WebhookDelivery.id.in_(batch))).rowcount
        db.commit()
        total += removed
        if removed < batch_size:
            return total


def send_test(db: Session, webhook: Webhook, resolver: Resolver | None = None) -> WebhookDelivery:
    """Envia o evento webhook.test na hora e guarda o resultado no historico. E uma tentativa
    unica: nao entra na fila de retentativas."""
    now = datetime.now(timezone.utc)
    payload = {
        "event": TEST_EVENT,
        "occurred_at": now.isoformat(),
        "data": {"message": "Teste de webhook do finance-app"},
    }
    delivery = WebhookDelivery(
        webhook_id=webhook.id,
        user_id=webhook.user_id,
        event=TEST_EVENT,
        payload=payload,
        status=DeliveryStatus.pending,
        attempts=0,
        id=uuid.uuid4(),
    )
    outcome = post_webhook(webhook, delivery.id, TEST_EVENT, payload, now, resolver)
    apply_outcome(delivery, outcome, now)
    if delivery.status == DeliveryStatus.pending:
        # Sem retentativa: uma falha aqui encerra a entrega
        delivery.status = DeliveryStatus.failed
        delivery.next_attempt_at = None
        delivery.finished_at = now
    db.add(delivery)
    db.flush()
    return delivery

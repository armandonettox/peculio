import hashlib
import hmac
import ipaddress
import json
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

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
# Quanto tempo uma entrega reivindicada fica "reservada" para quem esta enviando. Bem acima do
# pior caso do POST (timeout de 10 s por etapa, ate 3 IPs), e e o tempo que uma entrega leva para
# voltar a fila se o processo morrer no meio do envio.
LEASE = timedelta(minutes=5)
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


# Nome da extensao de requisicao que leva o IP validado ate o PinnedTransport
PIN_EXTENSION = "finance_pinned_ip"
# Quantos IPs validados tentamos, no maximo, quando a conexao falha (o pior caso soma 10 s cada)
MAX_PINNED_ADDRESSES = 3


class PinnedTransport(httpx.BaseTransport):
    """Conecta no IP validado em vez de deixar o httpx resolver o DNS de novo (DNS rebinding).

    A URL da requisicao passa a apontar para o IP, mas o cabecalho Host continua o do nome original
    (o httpx o monta antes, a partir da URL) e a extensao sni_hostname manda o nome original para o
    TLS: o SNI e a verificacao do certificado seguem sendo contra o nome, nunca contra o IP.
    Requisicao sem a extensao do pino passa direto, sem mudanca."""

    def __init__(self, inner: httpx.BaseTransport | None = None) -> None:
        self._inner = inner if inner is not None else httpx.HTTPTransport()

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        pinned_ip = request.extensions.pop(PIN_EXTENSION, None)
        if pinned_ip:
            request.extensions["sni_hostname"] = request.url.raw_host.decode("ascii")
            request.url = request.url.copy_with(host=pinned_ip)
        return self._inner.handle_request(request)

    def close(self) -> None:
        self._inner.close()


def make_client(inner: httpx.BaseTransport | None = None) -> httpx.Client:
    # Sem seguir redirecionamentos: um 302 para um endereco interno furaria a checagem de SSRF.
    # Obs: proxies do ambiente (HTTP_PROXY) continuam valendo e quem resolve o nome e o proxy;
    # nesse caso o pino nao se aplica (o httpx manda a extensao do pino adiante e o proxy a ignora).
    return httpx.Client(
        transport=PinnedTransport(inner), timeout=httpx.Timeout(TIMEOUT_SECONDS), follow_redirects=False
    )


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
    url: str,
    secret_encrypted: str,
    delivery_id: uuid.UUID,
    event: str,
    payload: dict,
    now: datetime,
    resolver: Resolver | None = None,
) -> Outcome:
    """Faz o POST assinado. Nunca levanta: qualquer falha vira um Outcome com a mensagem.

    Nao recebe a sessao do banco de proposito: o HTTP roda sem transacao e sem lock."""
    secret = decrypt_secret(secret_encrypted)
    if secret is None:
        return Outcome(False, error="Nao foi possivel ler o segredo do webhook")
    try:
        # De novo antes de entregar: o DNS pode ter mudado desde o cadastro. O DNS e consultado
        # so aqui; a conexao vai para um dos IPs validados (anti DNS rebinding).
        addresses = validate_webhook_url(url, resolver=resolver)
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
    outcome = Outcome(False, error="Nenhum endereco para entregar")
    for pinned_ip in pin_targets(url, addresses):
        try:
            with client_factory() as client:
                status_code, excerpt = _stream_post(client, url, body, headers, pinned_ip)
        except httpx.TimeoutException as error:
            outcome = Outcome(False, error=f"Tempo esgotado ({TIMEOUT_SECONDS} s) esperando a resposta")
            # So a falha ao conectar passa para o proximo IP; esperar a resposta ja e tarde
            # (o servidor pode ter recebido o POST) e nao reenviamos a outro IP.
            try_next = isinstance(error, httpx.ConnectTimeout)
        except httpx.HTTPError as error:
            outcome = Outcome(False, error=f"Falha de conexao ({type(error).__name__})")
            try_next = isinstance(error, httpx.ConnectError)
        except Exception as error:  # noqa: BLE001 - uma entrega com erro estranho nao pode derrubar o laco
            logger.warning("Erro inesperado ao entregar webhook: %s", type(error).__name__)
            return Outcome(False, error=f"Erro inesperado ({type(error).__name__})")
        else:
            if 200 <= status_code < 300:
                return Outcome(True, status_code=status_code, excerpt=excerpt)
            return Outcome(False, status_code=status_code, error=f"Resposta HTTP {status_code}", excerpt=excerpt)
        if not try_next:
            break
    return outcome


def _stream_post(
    client: httpx.Client, url: str, body: bytes, headers: dict[str, str], pinned_ip: str | None
) -> tuple[int, str]:
    # A extensao so e lida pelo PinnedTransport; outros transportes (testes, proxy) a ignoram
    extensions = {PIN_EXTENSION: pinned_ip} if pinned_ip else None
    with client.stream("POST", url, content=body, headers=headers, extensions=extensions) as response:
        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_bytes():
            chunks.append(chunk)
            size += len(chunk)
            if size >= MAX_RESPONSE_BYTES:
                break
        status_code = response.status_code
    return status_code, _clean(b"".join(chunks).decode("utf-8", errors="replace"), EXCERPT_CHARS)


def pin_targets(url: str, addresses: list[str]) -> list[str | None]:
    """IPs validados aos quais a conexao pode ir, na ordem. [None] quando nao ha o que fixar: URL
    com IP no lugar do nome (ja e o proprio IP) ou sem validacao de DNS (WEBHOOK_ALLOW_PRIVATE)."""
    host = urlsplit(url).hostname
    try:
        ipaddress.ip_address(host or "")
    except ValueError:
        pass
    else:
        return [None]
    if not addresses:
        return [None]
    return list(addresses[:MAX_PINNED_ADDRESSES])


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


@dataclass
class Claim:
    """O que o POST precisa saber, copiado para fora da sessao (depois do commit a linha nao e mais
    nossa para ler)."""

    delivery_id: uuid.UUID
    event: str
    payload: dict
    url: str
    secret_encrypted: str
    # Valor que next_attempt_at ganhou ao reivindicar. Serve para saber, na hora de gravar o
    # resultado, se a entrega continua sendo nossa (ver finish_attempt).
    lease_until: datetime | None = None
    # True quando nao ha nada para enviar (a entrega expirou porque o webhook esta pausado)
    expired: bool = False


def claim_next(db: Session, now: datetime) -> Claim | None:
    """Transacao curta 1: reivindica UMA pendente vencida e confirma. None se nao havia nenhuma.

    O SELECT ... FOR UPDATE SKIP LOCKED faz dois processos (ou duas rodadas) nunca pegarem a mesma
    entrega: quem chega depois pula a linha travada. Em vez de segurar esse lock durante o POST,
    a entrega recebe um lease: next_attempt_at vai para `now + LEASE` e o commit solta o lock.
    Enquanto o lease nao vence, ninguem mais a ve como vencida. Se o processo morrer no meio do
    POST, o lease vence sozinho e outra rodada tenta de novo (a tentativa so e contada quando o
    resultado e gravado).

    Se o webhook esta pausado, a entrega expira (estado final, motivo no historico) em vez de ser
    enviada. Reativar o webhook depois NAO reenvia o que expirou: um aviso de lancamento que chega
    dias depois, fora de ordem, faz mais mal do que bem. A reativacao vale so para eventos novos."""
    row = db.execute(
        select(WebhookDelivery, Webhook)
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
        return None
    delivery, webhook = row
    claim = Claim(delivery.id, delivery.event, delivery.payload, webhook.url, webhook.secret_encrypted)
    if not webhook.active:
        expire_delivery(delivery, PAUSED_REASON, now)
        claim.expired = True
    else:
        claim.lease_until = now + LEASE
        delivery.next_attempt_at = claim.lease_until
    db.commit()
    return claim


def finish_attempt(db: Session, claim: Claim, outcome: Outcome, now: datetime) -> bool:
    """Transacao curta 2: grava o resultado do POST. False se o resultado foi descartado.

    Descarta quando a entrega nao e mais nossa: foi apagada (webhook excluido), ja saiu da fila
    (ex: o webhook foi pausado durante o POST e a entrega expirou) ou o lease mudou, o que
    significa que ele venceu e outro worker a reivindicou. Assim um worker lento nunca
    sobrescreve o resultado de quem esta com o lease atual."""
    delivery = db.get(WebhookDelivery, claim.delivery_id, with_for_update=True, populate_existing=True)
    if (
        delivery is None
        or delivery.status != DeliveryStatus.pending
        or delivery.next_attempt_at != claim.lease_until
    ):
        db.rollback()
        return False
    apply_outcome(delivery, outcome, now)
    db.commit()
    return True


def deliver_next(db: Session, now: datetime | None = None, resolver: Resolver | None = None) -> bool:
    """Trata UMA pendente vencida. False se nao havia nenhuma.

    Tres passos, e o HTTP fica de fora de qualquer transacao ou lock: reivindicar (commit),
    fazer o POST, gravar o resultado (outra transacao)."""
    now = now or datetime.now(timezone.utc)
    claim = claim_next(db, now)
    if claim is None:
        return False
    if claim.expired:
        return True
    outcome = post_webhook(
        claim.url, claim.secret_encrypted, claim.delivery_id, claim.event, claim.payload, now, resolver
    )
    finish_attempt(db, claim, outcome, now)
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
    outcome = post_webhook(webhook.url, webhook.secret_encrypted, delivery.id, TEST_EVENT, payload, now, resolver)
    apply_outcome(delivery, outcome, now)
    if delivery.status == DeliveryStatus.pending:
        # Sem retentativa: uma falha aqui encerra a entrega
        delivery.status = DeliveryStatus.failed
        delivery.next_attempt_at = None
        delivery.finished_at = now
    db.add(delivery)
    db.flush()
    return delivery

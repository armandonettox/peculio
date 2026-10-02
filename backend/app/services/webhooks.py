import secrets
import uuid
from collections.abc import Callable, Sequence
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate
from app.core.two_factor import encrypt_secret
from app.core.webhook_url import WebhookUrlError, validate_webhook_url
from app.models.user import User
from app.models.webhook import DeliveryStatus, Webhook, WebhookDelivery
from app.schemas.webhook import WebhookCreate, WebhookUpdate
from app.services.webhook_delivery import PAUSED_REASON

MAX_WEBHOOKS_PER_USER = 20


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def get_owned_webhook(db: Session, user_id: uuid.UUID, webhook_id: uuid.UUID) -> Webhook:
    """404 tambem quando o webhook e de outro usuario, para nao revelar que ele existe."""
    webhook = db.execute(
        select(Webhook).where(Webhook.id == webhook_id, Webhook.user_id == user_id)
    ).scalar_one_or_none()
    if not webhook:
        raise AppError(404, ErrorCode.WEBHOOK_NOT_FOUND, "Webhook nao encontrado")
    return webhook


def check_url(url: str) -> None:
    try:
        validate_webhook_url(url)
    except WebhookUrlError as error:
        raise AppError(422, ErrorCode.WEBHOOK_URL_INVALID, str(error))


def _save(db: Session, webhook: Webhook) -> None:
    # A unicidade e do banco (indice em lower(nome)): vale mesmo com duas requisicoes juntas
    try:
        with db.begin_nested():
            db.add(webhook)
            db.flush()
    except IntegrityError:
        raise AppError(409, ErrorCode.WEBHOOK_NAME_TAKEN, "Ja existe um webhook com esse nome")


def create_webhook(db: Session, user: User, data: WebhookCreate) -> tuple[Webhook, str]:
    """Cria o webhook e devolve tambem o segredo em texto puro (a unica vez que ele sai)."""
    check_url(data.url)
    # Trava a linha do usuario para duas criacoes juntas nao passarem do limite
    db.execute(select(User.id).where(User.id == user.id).with_for_update())
    total = db.scalar(select(func.count()).select_from(Webhook).where(Webhook.user_id == user.id))
    if total >= MAX_WEBHOOKS_PER_USER:
        raise AppError(
            409,
            ErrorCode.WEBHOOK_LIMIT_REACHED,
            f"Limite de {MAX_WEBHOOKS_PER_USER} webhooks atingido",
        )
    secret = new_secret()
    webhook = Webhook(
        user_id=user.id,
        name=data.name,
        url=data.url,
        secret_encrypted=encrypt_secret(secret),
        events=list(data.events),
        active=data.active,
    )
    _save(db, webhook)
    return webhook, secret


def update_webhook(db: Session, webhook: Webhook, data: WebhookUpdate) -> Webhook:
    changes = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "url" in changes:
        check_url(changes["url"])
    # Pausar de novo um webhook ja pausado tambem esvazia a fila (idempotente)
    pausing = changes.get("active") is False
    for field, value in changes.items():
        setattr(webhook, field, value)
    _save(db, webhook)
    if pausing:
        expire_pending(db, webhook.id)
    return webhook


def expire_pending(db: Session, webhook_id: uuid.UUID) -> int:
    """Ao pausar, o que estava na fila expira na hora (estado final, com motivo). Reativar nao
    reenvia essas entregas: a reativacao vale so para eventos novos. Devolve quantas expiraram."""
    result = db.execute(
        update(WebhookDelivery)
        .where(WebhookDelivery.webhook_id == webhook_id, WebhookDelivery.status == DeliveryStatus.pending)
        .values(
            status=DeliveryStatus.expired,
            next_attempt_at=None,
            last_error=PAUSED_REASON,
            finished_at=datetime.now(timezone.utc),
        )
    )
    return result.rowcount


def rotate_secret(db: Session, webhook: Webhook) -> str:
    secret = new_secret()
    webhook.secret_encrypted = encrypt_secret(secret)
    db.flush()
    return secret


def delete_webhook(db: Session, webhook: Webhook) -> None:
    # As entregas (historico e fila) saem junto: ON DELETE CASCADE no banco
    db.delete(webhook)
    db.flush()


# ---------- Leitura ----------


def build_outputs(db: Session, webhooks: Sequence[Webhook]) -> list[dict]:
    """Monta a saida de varios webhooks com uma consulta so para a ultima entrega de todos."""
    if not webhooks:
        return []
    attempted_at = func.coalesce(WebhookDelivery.last_attempt_at, WebhookDelivery.created_at)
    rows = db.execute(
        select(WebhookDelivery.webhook_id, WebhookDelivery.status, attempted_at)
        .where(WebhookDelivery.webhook_id.in_([webhook.id for webhook in webhooks]))
        .distinct(WebhookDelivery.webhook_id)
        .order_by(WebhookDelivery.webhook_id, WebhookDelivery.created_at.desc(), WebhookDelivery.id.desc())
    ).all()
    last = {row[0]: (row[1], row[2]) for row in rows}
    return [
        {
            "id": webhook.id,
            "name": webhook.name,
            "url": webhook.url,
            "events": list(webhook.events),
            "active": webhook.active,
            "created_at": webhook.created_at,
            "last_delivery_status": last[webhook.id][0] if webhook.id in last else None,
            "last_delivery_at": last[webhook.id][1] if webhook.id in last else None,
        }
        for webhook in webhooks
    ]


def list_webhooks(db: Session, user_id: uuid.UUID, params: PageParams, q: str | None) -> dict:
    statement = select(Webhook).where(Webhook.user_id == user_id)
    if q and q.strip():
        # autoescape: um "%" ou "_" digitado na busca e texto comum, nao curinga
        statement = statement.where(func.lower(Webhook.name).contains(q.strip().lower(), autoescape=True))
    page = paginate(db, statement.order_by(func.lower(Webhook.name), Webhook.id), params)
    page["items"] = build_outputs(db, page["items"])
    return page


def list_deliveries(
    db: Session, webhook: Webhook, params: PageParams, status: DeliveryStatus | None
) -> dict:
    statement = select(WebhookDelivery).where(WebhookDelivery.webhook_id == webhook.id)
    if status is not None:
        statement = statement.where(WebhookDelivery.status == status)
    return paginate(db, statement.order_by(WebhookDelivery.created_at.desc(), WebhookDelivery.id.desc()), params)


# ---------- Fila de eventos (outbox) ----------


def enqueue_event(db: Session, user_id: uuid.UUID, event: str, build_data: Callable[[], dict]) -> int:
    """Cria uma entrega pendente para cada webhook ativo do usuario que assinou `event`.

    Roda dentro da transacao da operacao que gerou o evento (nada de commit aqui): se a operacao
    for desfeita, as entregas tambem, e se ela for confirmada, as entregas existem. `build_data`
    so e chamada se alguem assinou o evento, para quem nao usa webhooks nao pagar nada."""
    rows = db.execute(
        select(Webhook.id, Webhook.events).where(Webhook.user_id == user_id, Webhook.active.is_(True))
    ).all()
    webhook_ids = [row[0] for row in rows if event in row[1]]
    if not webhook_ids:
        return 0
    now = datetime.now(timezone.utc)
    payload = {"event": event, "occurred_at": now.isoformat(), "data": build_data()}
    for webhook_id in webhook_ids:
        db.add(
            WebhookDelivery(
                webhook_id=webhook_id,
                user_id=user_id,
                event=event,
                payload=payload,
                status=DeliveryStatus.pending,
                next_attempt_at=now,
            )
        )
    db.flush()
    return len(webhook_ids)

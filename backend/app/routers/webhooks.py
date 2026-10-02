import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PageParams
from app.models.user import User
from app.models.webhook import DeliveryStatus, Webhook
from app.schemas.webhook import DeliveryOut, WebhookCreate, WebhookOut, WebhookUpdate, WebhookWithSecretOut
from app.services import webhook_delivery
from app.services import webhooks as service

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _out(db: Session, webhook: Webhook) -> dict:
    return service.build_outputs(db, [webhook])[0]


@router.post("", response_model=WebhookWithSecretOut, status_code=status.HTTP_201_CREATED)
def create_webhook(data: WebhookCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    webhook, secret = service.create_webhook(db, user, data)
    db.commit()
    db.refresh(webhook)
    return {**_out(db, webhook), "secret": secret}


@router.get("", response_model=Page[WebhookOut])
def list_webhooks(
    params: PageParams = Depends(),
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_webhooks(db, user.id, params, q)


@router.get("/{webhook_id}", response_model=WebhookOut)
def get_webhook(webhook_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, service.get_owned_webhook(db, user.id, webhook_id))


@router.patch("/{webhook_id}", response_model=WebhookOut)
def update_webhook(
    webhook_id: uuid.UUID,
    data: WebhookUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    webhook = service.get_owned_webhook(db, user.id, webhook_id)
    service.update_webhook(db, webhook, data)
    db.commit()
    db.refresh(webhook)
    return _out(db, webhook)


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_webhook(webhook_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    webhook = service.get_owned_webhook(db, user.id, webhook_id)
    service.delete_webhook(db, webhook)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{webhook_id}/rotate-secret", response_model=WebhookWithSecretOut)
def rotate_secret(webhook_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Gera um segredo novo e invalida o antigo na hora. O novo aparece so nesta resposta."""
    webhook = service.get_owned_webhook(db, user.id, webhook_id)
    secret = service.rotate_secret(db, webhook)
    db.commit()
    db.refresh(webhook)
    return {**_out(db, webhook), "secret": secret}


@router.post("/{webhook_id}/test", response_model=DeliveryOut)
def test_webhook(webhook_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Envia o evento webhook.test agora, sem passar pela fila, e devolve o resultado."""
    webhook = service.get_owned_webhook(db, user.id, webhook_id)
    delivery = webhook_delivery.send_test(db, webhook)
    db.commit()
    db.refresh(delivery)
    return delivery


@router.get("/{webhook_id}/deliveries", response_model=Page[DeliveryOut])
def list_deliveries(
    webhook_id: uuid.UUID,
    params: PageParams = Depends(),
    status: DeliveryStatus | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    webhook = service.get_owned_webhook(db, user.id, webhook_id)
    return service.list_deliveries(db, webhook, params, status)

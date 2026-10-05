from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_admin, get_current_user
from app.core.errors import AppError, ErrorCode
from app.core.rate_limit import limiter
from app.models.instance_setting import InstanceSetting
from app.models.user import User
from app.schemas.instance import SecurityContactIn, SecurityContactOut

router = APIRouter(prefix="/instance", tags=["instance"])
well_known_router = APIRouter(tags=["instance"], include_in_schema=False)

SECURITY_CONTACT_KEY = "security_contact"
# security.txt precisa de validade (RFC 9116). Como o contato e do administrador e pode mudar, a validade e
# renovada a cada leitura em vez de ficar parada numa data que um dia passaria.
SECURITY_TXT_VALID_DAYS = 180


def _read(db: Session) -> InstanceSetting | None:
    return db.get(InstanceSetting, SECURITY_CONTACT_KEY)


def _out(setting: InstanceSetting | None) -> SecurityContactOut:
    return SecurityContactOut(
        contact=setting.value if setting else None, updated_at=setting.updated_at if setting else None
    )


@router.get("/security-contact", response_model=SecurityContactOut)
def get_security_contact(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Quem usa o app ve a quem relatar um problema de seguranca."""
    return _out(_read(db))


@router.put("/security-contact", response_model=SecurityContactOut)
def put_security_contact(
    data: SecurityContactIn, admin: User = Depends(get_current_admin), db: Session = Depends(get_db)
):
    """So administrador, e so pela tela (token de API nao muda o contato). Contato vazio apaga."""
    setting = _read(db)
    if data.contact is None:
        if setting:
            db.delete(setting)
            db.commit()
        return _out(None)
    if setting:
        setting.value = data.contact
    else:
        setting = InstanceSetting(key=SECURITY_CONTACT_KEY, value=data.contact)
        db.add(setting)
    db.commit()
    db.refresh(setting)
    return _out(setting)


@well_known_router.get("/.well-known/security.txt", response_class=PlainTextResponse)
@limiter.limit("60/minute")
def security_txt(request: Request, db: Session = Depends(get_db)):
    """Publico (padrao RFC 9116). Sem contato configurado nao existe: 404, em vez de inventar um endereco."""
    setting = _read(db)
    if not setting:
        raise AppError(404, ErrorCode.SECURITY_CONTACT_NOT_SET, "Esta instalacao nao definiu um contato de seguranca")
    contact = setting.value if setting.value.lower().startswith("https://") else f"mailto:{setting.value}"
    expires = (clock.utc_now() + timedelta(days=SECURITY_TXT_VALID_DAYS)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    body = f"Contact: {contact}\nExpires: {expires}\nPreferred-Languages: pt-BR, en\n"
    return PlainTextResponse(body, headers={"Cache-Control": "no-cache"})

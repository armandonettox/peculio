import uuid
from datetime import date

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PageParams
from app.models.user import User
from app.schemas.recurrence import RecurrenceCreate, RecurrenceOut, RecurrenceStatusOut, RecurrenceUpdate, RunResult
from app.services import recurrences as service

router = APIRouter(prefix="/recurrences", tags=["recurrences"])


@router.post("", response_model=RecurrenceOut, response_model_exclude_unset=True, status_code=status.HTTP_201_CREATED)
def create_recurrence(data: RecurrenceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recurrence = service.create_recurrence(db, user, data)
    # Primeira data hoje ou no passado e modo automatico: ja cria o que falta, sem esperar o laco de fundo
    service.process_recurrence(db, recurrence, clock.today())
    db.commit()
    db.refresh(recurrence)
    return service.to_output(db, recurrence)


@router.get("", response_model=Page[RecurrenceOut], response_model_exclude_unset=True)
def list_recurrences(
    params: PageParams = Depends(),
    q: str | None = None,
    active: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_recurrences(db, user.id, params, q, active)


# Precisa vir antes de /{recurrence_id}: senao "status"/"run" seriam lidos como um id
@router.get("/status", response_model=list[RecurrenceStatusOut])
def recurrences_status(
    on: date | None = None,
    include_archived: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ultimo e proximo vencimento de cada recorrente do modo de lembrete na data `on` (hoje, se
    omitida), e se o ultimo foi pago. Ordenadas pelo proximo vencimento."""
    return service.status(db, user.id, on or clock.today(), include_archived)


@router.post("/run", response_model=RunResult)
def run_now(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cria agora os lancamentos que faltam das recorrentes automaticas do usuario (o laco de fundo
    faz o mesmo sozinho a cada poucos minutos)."""
    return {"created": service.run_for_user(db, user, clock.today())}


@router.get("/{recurrence_id}", response_model=RecurrenceOut, response_model_exclude_unset=True)
def get_recurrence(recurrence_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.to_output(db, service.get_owned_recurrence(db, user.id, recurrence_id))


@router.patch("/{recurrence_id}", response_model=RecurrenceOut, response_model_exclude_unset=True)
def update_recurrence(
    recurrence_id: uuid.UUID,
    data: RecurrenceUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recurrence = service.get_owned_recurrence(db, user.id, recurrence_id)
    today = clock.today()
    service.update_recurrence(db, user, recurrence, data, today)
    service.process_recurrence(db, recurrence, today)
    db.commit()
    db.refresh(recurrence)
    return service.to_output(db, recurrence)


@router.delete("/{recurrence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurrence(recurrence_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recurrence = service.get_owned_recurrence(db, user.id, recurrence_id)
    service.delete_recurrence(db, recurrence)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

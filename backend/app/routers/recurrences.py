import uuid
from datetime import date

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PageParams
from app.models.user import User
from app.schemas.recurrence import RecurrenceCreate, RecurrenceOut, RecurrenceUpdate, RunResult
from app.services import recurrences as service

router = APIRouter(prefix="/recurrences", tags=["recurrences"])


@router.post("", response_model=RecurrenceOut, response_model_exclude_unset=True, status_code=status.HTTP_201_CREATED)
def create_recurrence(data: RecurrenceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recurrence = service.create_recurrence(db, user, data)
    # Primeira data hoje ou no passado: ja cria o que falta, sem esperar o laco de fundo
    service.process_recurrence(db, recurrence, clock.today())
    db.commit()
    db.refresh(recurrence)
    return service.to_output(recurrence)


@router.get("", response_model=Page[RecurrenceOut], response_model_exclude_unset=True)
def list_recurrences(
    params: PageParams = Depends(),
    q: str | None = None,
    active: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_recurrences(db, user.id, params, q, active)


# Precisa vir antes de /{recurrence_id}
@router.post("/run", response_model=RunResult)
def run_now(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cria agora os lancamentos que faltam das recorrentes do usuario (o laco de fundo faz o mesmo
    sozinho a cada poucos minutos)."""
    return {"created": service.run_for_user(db, user, clock.today())}


@router.get("/{recurrence_id}", response_model=RecurrenceOut, response_model_exclude_unset=True)
def get_recurrence(recurrence_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.to_output(service.get_owned_recurrence(db, user.id, recurrence_id))


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
    return service.to_output(recurrence)


@router.delete("/{recurrence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurrence(recurrence_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recurrence = service.get_owned_recurrence(db, user.id, recurrence_id)
    service.delete_recurrence(db, recurrence)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

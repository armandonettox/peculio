import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PageParams
from app.models.user import User
from app.schemas.piggy_bank import (
    PiggyBankCreate,
    PiggyBankEventCreate,
    PiggyBankEventOut,
    PiggyBankOut,
    PiggyBankUpdate,
)
from app.services import piggy_banks as service

router = APIRouter(prefix="/piggy-banks", tags=["piggy-banks"])


def _out(db: Session, piggy) -> dict:
    return service.build_outputs(db, [piggy], clock.today())[0]


@router.post("", response_model=PiggyBankOut, status_code=status.HTTP_201_CREATED)
def create_piggy_bank(data: PiggyBankCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    piggy = service.create_piggy_bank(db, user, data)
    db.commit()
    db.refresh(piggy)
    return _out(db, piggy)


@router.get("", response_model=Page[PiggyBankOut])
def list_piggy_banks(
    params: PageParams = Depends(),
    q: str | None = None,
    active: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_piggy_banks(db, user.id, params, q, active)


@router.get("/{piggy_bank_id}", response_model=PiggyBankOut)
def get_piggy_bank(piggy_bank_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, service.get_owned_piggy_bank(db, user.id, piggy_bank_id))


@router.patch("/{piggy_bank_id}", response_model=PiggyBankOut)
def update_piggy_bank(
    piggy_bank_id: uuid.UUID,
    data: PiggyBankUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    piggy = service.get_owned_piggy_bank(db, user.id, piggy_bank_id)
    service.update_piggy_bank(db, piggy, data)
    db.commit()
    db.refresh(piggy)
    return _out(db, piggy)


@router.delete("/{piggy_bank_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_piggy_bank(piggy_bank_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    piggy = service.get_owned_piggy_bank(db, user.id, piggy_bank_id)
    service.delete_piggy_bank(db, piggy)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{piggy_bank_id}/events", response_model=PiggyBankOut, status_code=status.HTTP_201_CREATED)
def add_event(
    piggy_bank_id: uuid.UUID,
    data: PiggyBankEventCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Guarda ou retira dinheiro. Devolve o cofrinho ja com o novo guardado."""
    piggy = service.get_owned_piggy_bank(db, user.id, piggy_bank_id)
    service.add_event(db, piggy, data)
    db.commit()
    db.refresh(piggy)
    return _out(db, piggy)


@router.get("/{piggy_bank_id}/events", response_model=Page[PiggyBankEventOut])
def list_events(
    piggy_bank_id: uuid.UUID,
    params: PageParams = Depends(),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_events(db, service.get_owned_piggy_bank(db, user.id, piggy_bank_id), params)

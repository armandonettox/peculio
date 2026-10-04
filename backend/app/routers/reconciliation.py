import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.reconciliation import (
    ChangedOut,
    ClearedSet,
    ReconciliationOut,
    ReconciliationViewOut,
    SplitIds,
    StatementIn,
)
from app.services import reconciliation as service

router = APIRouter(prefix="/reconciliation", tags=["reconciliation"])


def _view(db: Session, user: User, account_id: uuid.UUID, balance: Decimal, on) -> dict:
    return service.view(db, user, account_id, balance, on)


@router.get("/{account_id}", response_model=ReconciliationViewOut)
def get_view(
    account_id: uuid.UUID,
    statement_balance: Decimal = Query(description="O saldo que o extrato mostra"),
    statement_date: str | None = Query(default=None, description="AAAA-MM-DD; sem ele, hoje"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A conciliacao de uma conta: o conferido, o extrato, a diferenca e os lancamentos abertos ate a data."""
    from datetime import date as date_type

    from app.core.errors import AppError, ErrorCode

    try:
        on = date_type.fromisoformat(statement_date) if statement_date else clock.today()
    except ValueError as error:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "Informe a data como AAAA-MM-DD") from error
    if on > clock.today():
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "A data do extrato nao pode ser no futuro")
    return _view(db, user, account_id, statement_balance, on)


@router.put("/{account_id}/cleared", response_model=ChangedOut)
def set_cleared(account_id: uuid.UUID, data: ClearedSet, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Marca ou desmarca lancamentos como conferidos com o extrato."""
    changed = service.set_cleared(db, user, account_id, data.split_ids, data.cleared)
    db.commit()
    return {"changed": changed}


@router.post("/{account_id}/adjustment", response_model=ReconciliationViewOut, status_code=status.HTTP_201_CREATED)
def create_adjustment(account_id: uuid.UUID, data: StatementIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cria o lancamento de ajuste que zera a diferenca (ja conferido) e devolve a conciliacao atualizada."""
    service.adjust(db, user, account_id, data.statement_balance, data.statement_date)
    db.commit()
    return _view(db, user, account_id, data.statement_balance, data.statement_date)


@router.post("/{account_id}/close", response_model=ReconciliationOut, status_code=status.HTTP_201_CREATED)
def close_reconciliation(account_id: uuid.UUID, data: StatementIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Fecha a conciliacao (so com diferenca zero) e trava os lancamentos conferidos."""
    record = service.close(db, user, account_id, data.statement_balance, data.statement_date)
    db.commit()
    return next(item for item in service.history(db, user, account_id) if item["id"] == record.id)


@router.get("/{account_id}/history", response_model=list[ReconciliationOut])
def get_history(account_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.history(db, user, account_id)


@router.post("/{account_id}/unlock", response_model=ChangedOut)
def unlock(account_id: uuid.UUID, data: SplitIds, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Destrava lancamentos (continuam conferidos). A conciliacao deles deixa de valer."""
    changed = service.unlock(db, user, account_id, data.split_ids)
    db.commit()
    return {"changed": changed}


@router.delete("/{account_id}/closed/{reconciliation_id}", response_model=ChangedOut)
def undo_reconciliation(
    account_id: uuid.UUID, reconciliation_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Desfaz uma conciliacao inteira: destrava tudo o que ela travou e a marca como desfeita no historico."""
    changed = service.undo(db, user, account_id, reconciliation_id)
    db.commit()
    return {"changed": changed}

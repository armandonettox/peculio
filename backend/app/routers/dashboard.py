from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.dashboard import NetWorthOut, UpcomingOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/net-worth", response_model=NetWorthOut)
def get_net_worth(
    months: int = Query(12, ge=1, le=36),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Patrimonio de hoje e sua evolucao mes a mes, por moeda."""
    # Provisorio: o contrato esta fechado, a implementacao vem no trilho do backend
    raise HTTPException(status_code=501, detail="Ainda nao implementado")


@router.get("/upcoming", response_model=UpcomingOut)
def get_upcoming(
    days: int = Query(30, ge=1, le=90),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Contas a pagar e recorrentes dos proximos `days` dias, mais as contas atrasadas."""
    raise HTTPException(status_code=501, detail="Ainda nao implementado")

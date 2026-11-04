from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.dashboard import NetWorthOut, UpcomingOut
from app.services import dashboard as service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/net-worth", response_model=NetWorthOut)
def get_net_worth(
    months: int = Query(12, ge=1, le=36),
    forecast_months: int = Query(0, ge=0, le=6),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Patrimonio de hoje e sua evolucao mes a mes, por moeda.
    Com forecast_months > 0, estende a serie com pontos projetados pelas recorrencias ativas."""
    return service.net_worth(db, user.id, months, clock.today(), forecast_months)


@router.get("/upcoming", response_model=UpcomingOut)
def get_upcoming(
    days: int = Query(30, ge=1, le=90),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Contas a pagar e recorrentes dos proximos `days` dias, mais as contas atrasadas."""
    return service.upcoming(db, user.id, days, clock.today())

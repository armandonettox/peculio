from fastapi import APIRouter, Depends

from app.core import clock
from app.core.config import settings
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.clock import ClockOut

router = APIRouter(prefix="/clock", tags=["clock"])


@router.get("", response_model=ClockOut)
def get_clock(user: User = Depends(get_current_user)):
    """Hora do servidor, fuso do app e o dia de hoje nesse fuso."""
    moment = clock.utc_now()
    return ClockOut(now=moment, timezone=settings.app_timezone, today=clock.today(moment))

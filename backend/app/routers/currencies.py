from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.currency import Currency
from app.models.user import User
from app.schemas.account import CurrencyOut

router = APIRouter(prefix="/currencies", tags=["currencies"])


@router.get("", response_model=list[CurrencyOut])
def list_currencies(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Lista curta e fixa: sem paginacao
    return db.execute(select(Currency).order_by(Currency.code)).scalars().all()

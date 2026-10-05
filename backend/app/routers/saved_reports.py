import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.saved_report import SavedReportIn, SavedReportOut
from app.services import saved_reports as service

# Os relatorios personalizados salvos. Para rodar um, a tela usa o periodo e os filtros dele nas rotas de /reports.
router = APIRouter(prefix="/reports/saved", tags=["reports"])


@router.get("", response_model=list[SavedReportOut])
def list_saved_reports(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.list_reports(db, user.id)


@router.post("", response_model=SavedReportOut, status_code=status.HTTP_201_CREATED)
def create_saved_report(data: SavedReportIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    report = service.create_report(db, user, data)
    db.commit()
    return report


@router.get("/{report_id}", response_model=SavedReportOut)
def get_saved_report(report_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.get_owned_report(db, user.id, report_id)


@router.put("/{report_id}", response_model=SavedReportOut)
def update_saved_report(
    report_id: uuid.UUID, data: SavedReportIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    report = service.get_owned_report(db, user.id, report_id)
    report = service.update_report(db, user, report, data)
    db.commit()
    return report


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_report(report_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    report = service.get_owned_report(db, user.id, report_id)
    service.remove_report(db, report)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

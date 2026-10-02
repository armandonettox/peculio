import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PageParams
from app.models.user import User
from app.schemas.rule import (
    RuleApplyOut,
    RuleCreate,
    RuleGroupCreate,
    RuleGroupOut,
    RuleGroupUpdate,
    RuleOut,
    RulePreviewOut,
    RuleRunIn,
    RuleUpdate,
)
from app.services import rules as service
from app.services import rules_backfill

router = APIRouter(tags=["rules"])


# ---------- Grupos ----------


@router.post("/rule-groups", response_model=RuleGroupOut, status_code=status.HTTP_201_CREATED)
def create_group(data: RuleGroupCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = service.create_group(db, user, data)
    db.commit()
    db.refresh(group)
    return group


@router.get("/rule-groups", response_model=list[RuleGroupOut])
def list_groups(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.list_groups(db, user.id)


@router.patch("/rule-groups/{group_id}", response_model=RuleGroupOut)
def update_group(
    group_id: uuid.UUID,
    data: RuleGroupUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = service.get_owned_group(db, user.id, group_id)
    service.update_group(db, group, data)
    db.commit()
    db.refresh(group)
    return group


@router.delete("/rule-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(group_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    group = service.get_owned_group(db, user.id, group_id)
    service.delete_group(db, group)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Regras ----------


@router.post("/rules", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(data: RuleCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rule = service.create_rule(db, user, data)
    db.commit()
    db.refresh(rule)
    return rule


@router.get("/rules", response_model=Page[RuleOut])
def list_rules(
    params: PageParams = Depends(),
    q: str | None = None,
    active: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_rules(db, user.id, params, q, active)


# Precisam vir antes de /rules/{rule_id}
@router.post("/rules/preview", response_model=RulePreviewOut)
def preview_rules(data: RuleRunIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mostra o que as regras preencheriam nos lancamentos antigos, sem gravar nada."""
    return rules_backfill.run_rules(db, user, apply=False, **data.model_dump())


@router.post("/rules/apply", response_model=RuleApplyOut)
def apply_rules_to_old(data: RuleRunIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Aplica as regras nos lancamentos antigos. So preenche o que esta vazio."""
    result = rules_backfill.run_rules(db, user, apply=True, **data.model_dump())
    db.commit()
    return result


@router.get("/rules/{rule_id}", response_model=RuleOut)
def get_rule(rule_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return service.get_owned_rule(db, user.id, rule_id)


@router.patch("/rules/{rule_id}", response_model=RuleOut)
def update_rule(
    rule_id: uuid.UUID,
    data: RuleUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = service.get_owned_rule(db, user.id, rule_id)
    service.update_rule(db, rule, data)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rule = service.get_owned_rule(db, user.id, rule_id)
    service.delete_rule(db, rule)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

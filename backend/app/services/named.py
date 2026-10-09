"""Comportamento comum de categorias e tags: itens com nome unico por usuario."""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate


@dataclass(frozen=True)
class NamedResource:
    model: Any
    not_found_code: ErrorCode
    not_found_message: str
    taken_code: ErrorCode
    taken_message: str


def get_owned(db: Session, spec: NamedResource, user_id: uuid.UUID, item_id: uuid.UUID):
    """404 tambem quando o item e de outro usuario, para nao revelar que ele existe."""
    item = db.execute(
        select(spec.model).where(spec.model.id == item_id, spec.model.user_id == user_id)
    ).scalar_one_or_none()
    if not item:
        raise AppError(404, spec.not_found_code, spec.not_found_message)
    return item


def _save(db: Session, spec: NamedResource, item) -> None:
    # A unicidade e do banco (indice em lower(nome)): vale mesmo com duas requisicoes juntas
    try:
        with db.begin_nested():
            db.add(item)
            db.flush()
    except IntegrityError:
        raise AppError(409, spec.taken_code, spec.taken_message)


def create(db: Session, spec: NamedResource, user_id: uuid.UUID, **fields):
    item = spec.model(user_id=user_id, **fields)
    _save(db, spec, item)
    return item


def update(db: Session, spec: NamedResource, item, changes: dict[str, Any]):
    for field, value in changes.items():
        setattr(item, field, value)
    _save(db, spec, item)
    return item


def delete(db: Session, item) -> None:
    db.delete(item)
    db.flush()


def list_page(
    db: Session,
    spec: NamedResource,
    user_id: uuid.UUID,
    params: PageParams,
    q: str | None,
    extra_where: Sequence[ColumnElement[bool]] = (),
):
    statement = select(spec.model).where(spec.model.user_id == user_id, *extra_where)
    if q and q.strip():
        # autoescape: um "%" ou "_" digitado na busca e texto comum, nao curinga
        statement = statement.where(func.lower(spec.model.name).contains(q.strip().lower(), autoescape=True))
    # Desempate por id: sem ele, nomes iguais em caixa diferente trocam de pagina
    statement = statement.order_by(func.lower(spec.model.name), spec.model.id)
    return paginate(db, statement, params)

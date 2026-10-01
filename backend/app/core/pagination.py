from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

DEFAULT_LIMIT = 50
MAX_LIMIT = 200

T = TypeVar("T")


class PageParams:
    """Dependencia de paginacao: `Depends(PageParams)` na rota de listagem."""

    def __init__(
        self,
        limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
        offset: int = Query(0, ge=0),
    ):
        self.limit = limit
        self.offset = offset


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


def paginate(db: Session, statement: Select, params: PageParams) -> dict:
    """Conta o total e devolve a pagina pedida. A consulta precisa ter ORDER BY com
    desempate por id; sem ordem estavel, o mesmo registro pode aparecer em duas paginas."""
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    items = db.execute(statement.limit(params.limit).offset(params.offset)).scalars().all()
    return {"items": items, "total": total, "limit": params.limit, "offset": params.offset}

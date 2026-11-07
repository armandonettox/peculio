import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models.account import Account
from app.models.category import Category, CategoryKind
from app.models.favorite import Favorite
from app.models.transaction import TransactionSplit, TransactionType
from app.schemas.favorite import FavoriteIn
from app.services.accounts import get_owned_account
from app.services.transactions import CATEGORY_KIND_FOR_TYPE, get_owned_category


def get_owned_favorite(db: Session, user_id: uuid.UUID, favorite_id: uuid.UUID) -> Favorite:
    favorite = db.execute(
        select(Favorite).where(Favorite.id == favorite_id, Favorite.user_id == user_id)
    ).scalar_one_or_none()
    if not favorite:
        raise AppError(404, ErrorCode.FAVORITE_NOT_FOUND, "Favorito nao encontrado")
    return favorite


def save_favorite(db: Session, user_id: uuid.UUID, data: FavoriteIn) -> tuple[Favorite, bool]:
    """Cria o favorito ou, se a descricao ja e favorita nesse sentido, atualiza a categoria e a conta dele.
    Devolve o favorito e se ele foi criado agora."""
    if data.category_id is not None:
        category = get_owned_category(db, user_id, data.category_id)
        if category.kind != CATEGORY_KIND_FOR_TYPE[data.type]:
            raise AppError(
                400,
                ErrorCode.CATEGORY_KIND_MISMATCH,
                "Esta categoria nao vale para este sentido (entrada ou saida)",
            )
    if data.account_id is not None:
        get_owned_account(db, user_id, data.account_id)

    existing = db.execute(
        select(Favorite).where(
            Favorite.user_id == user_id,
            Favorite.type == data.type,
            func.lower(Favorite.description) == data.description.lower(),
        )
    ).scalar_one_or_none()
    if existing:
        existing.description = data.description
        existing.category_id = data.category_id
        existing.account_id = data.account_id
        db.flush()
        return existing, False

    favorite = Favorite(
        user_id=user_id,
        type=data.type,
        description=data.description,
        category_id=data.category_id,
        account_id=data.account_id,
    )
    db.add(favorite)
    db.flush()
    return favorite, True


def list_favorites(db: Session, user_id: uuid.UUID, type: str | None) -> list[Favorite]:
    statement = select(Favorite).where(Favorite.user_id == user_id)
    if type is not None:
        statement = statement.where(Favorite.type == type)
    return list(db.execute(statement.order_by(func.lower(Favorite.description))).scalars())


def suggestions(db: Session, user_id: uuid.UUID, type: str, q: str, limit: int) -> list[dict]:
    """Sugestoes para a descricao de um lancamento novo: primeiro os favoritos, depois o que ja foi lancado no mesmo
    sentido (a descricao mais recente de cada), sem repetir o que ja e favorito. Sempre sem o valor."""
    needle = q.strip()
    favorite_query = select(Favorite).where(Favorite.user_id == user_id, Favorite.type == type)
    if needle:
        favorite_query = favorite_query.where(func.lower(Favorite.description).contains(needle.lower(), autoescape=True))
    favorites = list(db.execute(favorite_query.order_by(func.lower(Favorite.description)).limit(limit)).scalars())
    items = [
        {
            "description": favorite.description,
            "category_id": favorite.category_id,
            "account_id": favorite.account_id,
            "favorite_id": favorite.id,
        }
        for favorite in favorites
    ]
    if len(items) >= limit:
        return items

    # A conta do usuario e a de onde sai (saida) ou a que recebe (entrada)
    own = TransactionSplit.source_account_id if type == "withdrawal" else TransactionSplit.destination_account_id
    split_type = TransactionType.withdrawal if type == "withdrawal" else TransactionType.deposit
    history_query = (
        select(
            TransactionSplit.description,
            TransactionSplit.category_id,
            own.label("account_id"),
            TransactionSplit.date,
            TransactionSplit.created_at,
        )
        .join(Account, Account.id == own)
        .outerjoin(Category, Category.id == TransactionSplit.category_id)
        .where(TransactionSplit.user_id == user_id, TransactionSplit.type == split_type)
        .order_by(TransactionSplit.date.desc(), TransactionSplit.created_at.desc())
    )
    if needle:
        history_query = history_query.where(func.lower(TransactionSplit.description).contains(needle.lower(), autoescape=True))

    taken = {item["description"].lower() for item in items}
    # Le um pouco mais do que o limite: varias linhas podem ter a mesma descricao
    for description, category_id, account_id, _date, _created in db.execute(history_query.limit(limit * 6)).all():
        key = description.lower()
        if key in taken:
            continue
        taken.add(key)
        items.append(
            {"description": description, "category_id": category_id, "account_id": account_id, "favorite_id": None}
        )
        if len(items) >= limit:
            break
    return items

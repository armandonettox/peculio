# Todo model novo precisa ser importado aqui para o Alembic enxergar a tabela
from app.models.account import Account  # noqa: F401
from app.models.bill import Bill  # noqa: F401
from app.models.budget import Budget  # noqa: F401
from app.models.category import Category  # noqa: F401
from app.models.currency import Currency  # noqa: F401
from app.models.tag import Tag  # noqa: F401
from app.models.transaction import Transaction, TransactionSplit  # noqa: F401
from app.models.user import Invite, User  # noqa: F401

# Todo model novo precisa ser importado aqui para o Alembic enxergar a tabela
from app.models.account import Account  # noqa: F401
from app.models.api_token import ApiToken  # noqa: F401
from app.models.attachment import Attachment  # noqa: F401
from app.models.bill import Bill  # noqa: F401
from app.models.budget import Budget, BudgetAllocation, BudgetTemplate  # noqa: F401
from app.models.category import Category  # noqa: F401
from app.models.currency import Currency  # noqa: F401
from app.models.instance_setting import InstanceSetting  # noqa: F401
from app.models.piggy_bank import PiggyBank, PiggyBankEvent  # noqa: F401
from app.models.reconciliation import AccountClearing, Reconciliation  # noqa: F401
from app.models.recurrence import Recurrence  # noqa: F401
from app.models.rule import Rule, RuleGroup  # noqa: F401
from app.models.saved_report import SavedReport  # noqa: F401
from app.models.tag import Tag  # noqa: F401
from app.models.transaction import Transaction, TransactionSplit  # noqa: F401
from app.models.user import Invite, User  # noqa: F401
from app.models.webhook import Webhook, WebhookDelivery  # noqa: F401

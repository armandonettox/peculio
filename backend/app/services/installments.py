import uuid
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models.account import AccountRole
from app.models.bill import BillFrequency
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import TransactionCreate
from app.services.accounts import get_owned_account
from app.services.bills import occurrence
from app.services.transactions import create_transaction


def split_amount(total: Decimal, count: int) -> list[Decimal]:
    """Divide o total em `count` partes iguais (2 casas). A ultima parte absorve o resto da
    divisao, para a soma das partes bater exatamente com o total."""
    share = (total / count).quantize(Decimal("0.01"))
    parts = [share] * (count - 1)
    parts.append(total - share * (count - 1))
    return parts


def create_installments(db: Session, user: User, template: TransactionCreate, count: int) -> list[Transaction]:
    """Cria as `count` parcelas da compra, uma por mes a partir da data do primeiro split, cada uma
    com seu valor e descricao numerada. Mesmo grupo (`installment_group_id`) para todas."""
    split = template.splits[0]
    account = get_owned_account(db, user.id, split.account_id)
    if account.role != AccountRole.credit_card:
        raise AppError(400, ErrorCode.ACCOUNT_NOT_CREDIT_CARD, "Parcelamento so vale para uma conta de cartao de credito")
    amounts = split_amount(split.amount, count)
    group_id = uuid.uuid4()
    transactions = []
    for index in range(count):
        installment_date = occurrence(split.date, BillFrequency.monthly, index)
        installment_split = split.model_copy(
            update={
                "date": installment_date,
                "amount": amounts[index],
                "description": f"{split.description} ({index + 1}/{count})",
            }
        )
        installment_template = template.model_copy(update={"splits": [installment_split]})
        transaction = create_transaction(db, user, installment_template)
        transaction.installment_group_id = group_id
        transaction.installment_index = index
        transaction.installment_count = count
        transactions.append(transaction)
    db.flush()
    return transactions

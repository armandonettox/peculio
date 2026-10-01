"""O saldo e sempre entradas menos saidas somando os splits; nao existe saldo guardado."""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.account import Account, AccountType
from app.models.transaction import Transaction, TransactionSplit, TransactionType
from app.services.ledger import account_balance, balances_by_account
from tests.conftest import make_user


@pytest.fixture
def user(db_session):
    return make_user(db_session)


def new_account(db_session, user, name, currency="BRL"):
    account = Account(user_id=user.id, name=name, type=AccountType.asset, currency_code=currency)
    db_session.add(account)
    db_session.flush()
    return account


def move(db_session, user, source, destination, amount, **extra):
    transaction = Transaction(user_id=user.id)
    db_session.add(transaction)
    db_session.flush()
    split = TransactionSplit(
        transaction_id=transaction.id,
        user_id=user.id,
        type=extra.pop("type", TransactionType.transfer),
        date=extra.pop("date", date(2026, 1, 1)),
        description=extra.pop("description", "Movimento"),
        source_account_id=source.id,
        destination_account_id=destination.id,
        amount=Decimal(amount),
        currency_code="BRL",
        **extra,
    )
    db_session.add(split)
    db_session.flush()
    return split


def test_account_without_movement_has_zero_balance(db_session, user):
    account = new_account(db_session, user, "A")
    assert account_balance(db_session, account.id) == Decimal("0")


def test_balance_is_inflow_minus_outflow(db_session, user):
    a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")
    move(db_session, user, b, a, "100.00")
    move(db_session, user, a, b, "30.25")
    move(db_session, user, b, a, "5.00")
    assert account_balance(db_session, a.id) == Decimal("74.75")
    assert account_balance(db_session, b.id) == Decimal("-74.75")


def test_a_transfer_between_two_accounts_nets_to_zero(db_session, user):
    a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")
    move(db_session, user, a, b, "10.00")
    total = sum(balances_by_account(db_session, [a.id, b.id]).values())
    assert total == Decimal("0")


def test_balances_for_many_accounts_come_in_one_call_and_include_empty_ones(db_session, user):
    a, b, c = (new_account(db_session, user, n) for n in "ABC")
    move(db_session, user, c, a, "10.00")
    result = balances_by_account(db_session, [a.id, b.id])
    assert result == {a.id: Decimal("10.00"), b.id: Decimal("0")}


def test_no_accounts_means_no_query_and_empty_result(db_session):
    assert balances_by_account(db_session, []) == {}


def test_balance_uses_exact_decimals_not_floats(db_session, user):
    a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")
    for _ in range(10):
        move(db_session, user, b, a, "0.10")
    # Com float, 10 x 0.1 daria 0.9999999999999999
    assert account_balance(db_session, a.id) == Decimal("1.00")


# ---------- Restricoes do banco ----------


def test_amount_must_be_positive(db_session, user):
    a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")
    for amount in ("0", "-5.00"):
        with pytest.raises(IntegrityError):
            move(db_session, user, a, b, amount)
        db_session.rollback()
        a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")


def test_source_and_destination_must_differ(db_session, user):
    a = new_account(db_session, user, "A")
    with pytest.raises(IntegrityError):
        move(db_session, user, a, a, "10.00")


def test_foreign_amount_and_currency_come_together(db_session, user):
    a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")
    with pytest.raises(IntegrityError):
        move(db_session, user, a, b, "10.00", foreign_amount=Decimal("2.00"))
    db_session.rollback()


def test_foreign_amount_with_currency_is_accepted(db_session, user):
    a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")
    split = move(db_session, user, a, b, "50.00", foreign_amount=Decimal("10.00"), foreign_currency_code="USD")
    assert split.foreign_currency_code == "USD"


def test_foreign_amount_must_be_positive(db_session, user):
    a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")
    with pytest.raises(IntegrityError):
        move(db_session, user, a, b, "50.00", foreign_amount=Decimal("-1.00"), foreign_currency_code="USD")


def test_database_refuses_to_delete_an_account_that_has_movement(db_session, user):
    a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")
    move(db_session, user, a, b, "10.00")
    db_session.commit()
    with pytest.raises(IntegrityError):
        db_session.delete(a)
        db_session.flush()
    db_session.rollback()


def test_deleting_a_transaction_removes_its_splits(db_session, user):
    a, b = new_account(db_session, user, "A"), new_account(db_session, user, "B")
    split = move(db_session, user, a, b, "10.00")
    db_session.commit()
    db_session.delete(db_session.get(Transaction, split.transaction_id))
    db_session.commit()
    assert db_session.query(TransactionSplit).count() == 0


def test_account_name_is_unique_per_user_and_type_at_the_database_level(db_session, user):
    new_account(db_session, user, "A")
    with pytest.raises(IntegrityError):
        new_account(db_session, user, "A")


def test_unknown_currency_is_refused_by_the_database(db_session, user):
    with pytest.raises(IntegrityError):
        new_account(db_session, user, "A", currency="XXX")


def test_random_account_id_has_no_balance_entries(db_session):
    missing = uuid.uuid4()
    assert balances_by_account(db_session, [missing]) == {missing: Decimal("0")}

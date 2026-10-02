import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from app.core import clock
from app.core.database import SessionLocal
from app.models.account import Account
from app.models.piggy_bank import PiggyBankEvent
from app.services import piggy_banks as service
from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/piggy-banks"
ACCOUNTS_URL = "/api/v1/accounts"
TX_URL = "/api/v1/transactions"

TODAY = clock.today()


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, **overrides):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "1000.00", **overrides}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


@pytest.fixture
def account_id(client, headers):
    return make_account(client, headers)


def make_piggy(client, headers, account_id, **overrides):
    body = {"name": "Viagem", "account_id": account_id, "target_amount": "600.00", **overrides}
    return client.post(URL, json=body, headers=headers)


def event(client, headers, piggy_id, kind="add", amount="100.00", **extra):
    return client.post(f"{URL}/{piggy_id}/events", json={"kind": kind, "amount": amount, **extra}, headers=headers)


def get_piggy(client, headers, piggy_id):
    return client.get(f"{URL}/{piggy_id}", headers=headers).json()


def balance_of(client, headers, account_id):
    return client.get(f"{ACCOUNTS_URL}/{account_id}", headers=headers).json()["balance"]


# ---------- CRUD ----------


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={}).status_code == 401
    assert client.post(f"{URL}/{uuid.uuid4()}/events", json={}).status_code == 401


def test_create_returns_the_piggy_bank_with_zero_saved(client, headers, account_id):
    resp = make_piggy(client, headers, account_id, name="  Viagem ", target_date="2027-01-31")
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Viagem"
    assert body["account_id"] == account_id and body["account_name"] == "Nubank"
    assert body["currency_code"] == "BRL"
    assert (body["target_amount"], body["saved"], body["remaining"], body["percent"]) == ("600.00", "0.00", "600.00", 0)
    assert body["target_date"] == "2027-01-31"
    assert body["account_available"] == "1000.00"


@pytest.mark.parametrize(
    "overrides",
    [
        {"target_amount": "0"},
        {"target_amount": "-5"},
        {"target_amount": "abc"},
        {"target_amount": "10.555"},
        {"name": ""},
        {"name": "   "},
        {"target_date": "05/03/2026"},
        {"unknown": 1},
    ],
)
def test_create_validation_returns_422(client, headers, account_id, overrides):
    assert make_piggy(client, headers, account_id, **overrides).status_code == 422


def test_the_account_must_exist_belong_to_the_user_and_be_an_asset(client, headers, account_id, db_session):
    unknown = make_piggy(client, headers, str(uuid.uuid4()))
    assert unknown.status_code == 404 and unknown.json()["code"] == "account_not_found"

    debt = make_account(client, headers, name="Financ", type="liability", role="mortgage", opening_balance="0")
    resp = make_piggy(client, headers, debt)
    assert resp.status_code == 400 and resp.json()["code"] == "piggy_bank_account_invalid"

    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    foreign = make_account(client, other, name="Dela")
    assert make_piggy(client, headers, foreign).status_code == 404


def test_the_currency_decimal_places_apply_to_the_target(client, headers):
    yen = make_account(client, headers, name="Toquio", currency_code="JPY", opening_balance="50000")
    resp = make_piggy(client, headers, yen, target_amount="1000.5")
    assert resp.status_code == 400 and resp.json()["code"] == "invalid_amount"
    ok = make_piggy(client, headers, yen, target_amount="10000").json()
    assert (ok["target_amount"], ok["saved"], ok["account_available"]) == ("10000", "0", "50000")


def test_editing_the_target_also_respects_the_currency_places(client, headers):
    yen = make_account(client, headers, name="Toquio", currency_code="JPY", opening_balance="50000")
    piggy_id = make_piggy(client, headers, yen, target_amount="10000").json()["id"]
    resp = client.patch(f"{URL}/{piggy_id}", json={"target_amount": "10000.5"}, headers=headers)
    assert resp.status_code == 400 and resp.json()["code"] == "invalid_amount"
    assert get_piggy(client, headers, piggy_id)["target_amount"] == "10000"
    assert client.patch(f"{URL}/{piggy_id}", json={"target_amount": "12000"}, headers=headers).json()["target_amount"] == "12000"


def test_name_is_unique_per_user_ignoring_case(client, headers, account_id, db_session):
    make_piggy(client, headers, account_id, name="Viagem")
    resp = make_piggy(client, headers, account_id, name="VIAGEM")
    assert resp.status_code == 409 and resp.json()["code"] == "piggy_bank_name_taken"

    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    other_account = make_account(client, other, name="Dela")
    assert make_piggy(client, other, other_account, name="Viagem").status_code == 201


def test_list_is_alphabetical_and_filters_by_name(client, headers, account_id):
    for name in ("Viagem", "carro", "Casa"):
        make_piggy(client, headers, account_id, name=name)
    assert [p["name"] for p in client.get(URL, headers=headers).json()["items"]] == ["carro", "Casa", "Viagem"]
    assert [p["name"] for p in client.get(URL, params={"q": "CAS"}, headers=headers).json()["items"]] == ["Casa"]
    assert client.get(URL, params={"q": "%"}, headers=headers).json()["total"] == 0


def test_other_users_piggy_bank_is_404_everywhere(client, headers, account_id, db_session):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    for call in (
        client.get(f"{URL}/{piggy_id}", headers=other),
        client.patch(f"{URL}/{piggy_id}", json={"name": "X"}, headers=other),
        client.delete(f"{URL}/{piggy_id}", headers=other),
        client.post(f"{URL}/{piggy_id}/events", json={"kind": "add", "amount": "1"}, headers=other),
        client.get(f"{URL}/{piggy_id}/events", headers=other),
    ):
        assert call.status_code == 404 and call.json()["code"] == "piggy_bank_not_found"
    assert client.get(URL, headers=other).json()["total"] == 0
    assert client.get(f"{URL}/{uuid.uuid4()}", headers=headers).status_code == 404


def test_patch_changes_only_what_was_sent_and_null_clears_the_date(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id, target_date="2027-01-31").json()["id"]
    changed = client.patch(f"{URL}/{piggy_id}", json={"target_amount": "900.00"}, headers=headers).json()
    assert changed["target_amount"] == "900.00" and changed["name"] == "Viagem"
    assert changed["target_date"] == "2027-01-31"

    cleared = client.patch(f"{URL}/{piggy_id}", json={"target_date": None}, headers=headers).json()
    assert cleared["target_date"] is None and cleared["target_amount"] == "900.00"

    nulls = client.patch(f"{URL}/{piggy_id}", json={"name": None, "target_amount": None}, headers=headers).json()
    assert nulls["name"] == "Viagem" and nulls["target_amount"] == "900.00"


def test_patch_cannot_change_the_account_and_validates(client, headers, account_id):
    first = make_piggy(client, headers, account_id, name="A").json()["id"]
    make_piggy(client, headers, account_id, name="B")
    assert client.patch(f"{URL}/{first}", json={"account_id": str(uuid.uuid4())}, headers=headers).status_code == 422
    assert client.patch(f"{URL}/{first}", json={"target_amount": "0"}, headers=headers).status_code == 422
    clash = client.patch(f"{URL}/{first}", json={"name": "b"}, headers=headers)
    assert clash.status_code == 409 and clash.json()["code"] == "piggy_bank_name_taken"


def test_delete_frees_the_reserve_and_removes_the_history(client, headers, account_id, db_session):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    event(client, headers, piggy_id, amount="400.00")
    other = make_piggy(client, headers, account_id, name="Outro").json()["id"]
    assert get_piggy(client, headers, other)["account_available"] == "600.00"

    assert client.delete(f"{URL}/{piggy_id}", headers=headers).status_code == 204
    assert client.get(f"{URL}/{piggy_id}", headers=headers).status_code == 404
    assert get_piggy(client, headers, other)["account_available"] == "1000.00"
    assert db_session.query(PiggyBankEvent).count() == 0


# ---------- Guardar e retirar ----------


def test_adding_updates_saved_remaining_and_percent_without_touching_the_balance(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    body = event(client, headers, piggy_id, amount="150.00").json()
    assert (body["saved"], body["remaining"], body["percent"]) == ("150.00", "450.00", 25)
    assert body["account_available"] == "850.00"
    # O dinheiro continua na conta
    assert balance_of(client, headers, account_id) == "1000.00"


def test_removing_gives_the_money_back_to_the_available(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    event(client, headers, piggy_id, amount="300.00")
    body = event(client, headers, piggy_id, kind="remove", amount="100.00").json()
    assert (body["saved"], body["account_available"]) == ("200.00", "800.00")


def test_cannot_add_more_than_what_is_available(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    over = event(client, headers, piggy_id, amount="1000.01")
    assert over.status_code == 400 and over.json()["code"] == "piggy_bank_not_enough_available"
    assert get_piggy(client, headers, piggy_id)["saved"] == "0.00"
    # Exatamente o disponivel pode
    assert event(client, headers, piggy_id, amount="1000.00").status_code == 201
    assert get_piggy(client, headers, piggy_id)["account_available"] == "0.00"


def test_cannot_remove_more_than_what_is_saved(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    event(client, headers, piggy_id, amount="100.00")
    over = event(client, headers, piggy_id, kind="remove", amount="100.01")
    assert over.status_code == 400 and over.json()["code"] == "piggy_bank_not_enough_saved"
    assert event(client, headers, piggy_id, kind="remove", amount="100.00").status_code == 201
    assert get_piggy(client, headers, piggy_id)["saved"] == "0.00"


def test_removing_from_an_empty_piggy_bank_is_refused(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    assert event(client, headers, piggy_id, kind="remove", amount="1.00").status_code == 400


def test_piggy_banks_of_the_same_account_share_what_is_available(client, headers, account_id):
    first = make_piggy(client, headers, account_id, name="A").json()["id"]
    second = make_piggy(client, headers, account_id, name="B").json()["id"]
    event(client, headers, first, amount="700.00")

    # So sobram 300 na conta: o que esta no primeiro cofrinho nao pode ser guardado de novo
    refused = event(client, headers, second, amount="300.01")
    assert refused.status_code == 400 and refused.json()["code"] == "piggy_bank_not_enough_available"
    assert event(client, headers, second, amount="300.00").status_code == 201
    assert get_piggy(client, headers, first)["account_available"] == "0.00"


def test_piggy_banks_of_different_accounts_do_not_share(client, headers, account_id):
    other_account = make_account(client, headers, name="Poupanca", opening_balance="50.00")
    first = make_piggy(client, headers, account_id, name="A").json()["id"]
    second = make_piggy(client, headers, other_account, name="B").json()["id"]
    event(client, headers, first, amount="1000.00")
    assert event(client, headers, second, amount="50.00").status_code == 201
    assert get_piggy(client, headers, second)["account_available"] == "0.00"


def test_spending_below_the_reserved_amount_makes_the_available_negative_but_is_not_blocked(
    client, headers, account_id
):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    event(client, headers, piggy_id, amount="800.00")
    spend = client.post(
        TX_URL,
        json={"splits": [{
            "type": "withdrawal", "date": TODAY.isoformat(), "description": "Compra", "amount": "500.00",
            "currency_code": "BRL", "account_id": account_id, "counterparty_name": "Loja",
        }]},
        headers=headers,
    )
    assert spend.status_code == 201
    body = get_piggy(client, headers, piggy_id)
    # Saldo 500, guardado 800: faltam 300 para cobrir a reserva
    assert body["account_available"] == "-300.00" and body["saved"] == "800.00"
    # E nao da para guardar mais nada ate cobrir
    assert event(client, headers, piggy_id, amount="1.00").status_code == 400


def test_a_deposit_raises_the_available(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    event(client, headers, piggy_id, amount="1000.00")
    client.post(
        TX_URL,
        json={"splits": [{
            "type": "deposit", "date": TODAY.isoformat(), "description": "Salario", "amount": "250.00",
            "currency_code": "BRL", "account_id": account_id, "counterparty_name": "Empresa",
        }]},
        headers=headers,
    )
    assert get_piggy(client, headers, piggy_id)["account_available"] == "250.00"


def test_saving_beyond_the_target_is_allowed_and_percent_passes_100(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id, target_amount="100.00").json()["id"]
    body = event(client, headers, piggy_id, amount="150.00").json()
    assert (body["saved"], body["remaining"], body["percent"]) == ("150.00", "0.00", 150)


def test_percent_never_rounds_up_to_the_target(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id, target_amount="1000.00").json()["id"]
    assert event(client, headers, piggy_id, amount="999.99").json()["percent"] == 99
    assert event(client, headers, piggy_id, amount="0.01").json()["percent"] == 100


@pytest.mark.parametrize(
    "payload",
    [
        {"kind": "add", "amount": "0"},
        {"kind": "add", "amount": "-5"},
        {"kind": "add", "amount": "abc"},
        {"kind": "add", "amount": "1.005"},
        {"kind": "transfer", "amount": "10"},
        {"amount": "10"},
        {"kind": "add", "amount": "10", "unknown": 1},
    ],
)
def test_event_validation_returns_422(client, headers, account_id, payload):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    assert client.post(f"{URL}/{piggy_id}/events", json=payload, headers=headers).status_code == 422


def test_event_amount_respects_the_currency_places(client, headers):
    yen = make_account(client, headers, name="Toquio", currency_code="JPY", opening_balance="50000")
    piggy_id = make_piggy(client, headers, yen, target_amount="10000").json()["id"]
    resp = event(client, headers, piggy_id, amount="10.5")
    assert resp.status_code == 400 and resp.json()["code"] == "invalid_amount"
    assert event(client, headers, piggy_id, amount="1000").json()["saved"] == "1000"


def test_a_future_date_is_refused_and_today_is_the_default(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    future = event(client, headers, piggy_id, date=(TODAY + timedelta(days=1)).isoformat())
    assert future.status_code == 422
    event(client, headers, piggy_id, amount="10.00")
    event(client, headers, piggy_id, amount="20.00", date=(TODAY - timedelta(days=3)).isoformat(), note="  Bonus ")
    items = client.get(f"{URL}/{piggy_id}/events", headers=headers).json()["items"]
    assert [(i["amount"], i["date"], i["note"]) for i in items] == [
        ("10.00", TODAY.isoformat(), None),
        ("20.00", (TODAY - timedelta(days=3)).isoformat(), "Bonus"),
    ]


def test_events_list_has_kind_positive_amounts_and_newest_first(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    event(client, headers, piggy_id, amount="100.00", date=(TODAY - timedelta(days=2)).isoformat())
    event(client, headers, piggy_id, kind="remove", amount="30.00", date=(TODAY - timedelta(days=1)).isoformat())
    page = client.get(f"{URL}/{piggy_id}/events", headers=headers).json()
    assert page["total"] == 2
    assert [(i["kind"], i["amount"]) for i in page["items"]] == [("remove", "30.00"), ("add", "100.00")]


def test_events_are_paginated(client, headers, account_id):
    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    for _ in range(3):
        event(client, headers, piggy_id, amount="1.00")
    page = client.get(f"{URL}/{piggy_id}/events", params={"limit": 2, "offset": 0}, headers=headers).json()
    assert (page["total"], len(page["items"])) == (3, 2)


def test_the_account_row_is_locked_while_reserving(client, headers, account_id, db_session):
    """Duas requisicoes juntas nao podem reservar o mesmo dinheiro: guardar trava a linha da conta."""
    from sqlalchemy.exc import OperationalError

    piggy_id = make_piggy(client, headers, account_id).json()["id"]
    # O processo A segura a conta
    db_session.execute(select(Account).where(Account.id == uuid.UUID(account_id)).with_for_update()).scalar_one()

    with SessionLocal() as other:
        other.execute(text("SET lock_timeout = '1s'"))
        piggy = service.get_owned_piggy_bank(other, db_session.get(Account, uuid.UUID(account_id)).user_id, uuid.UUID(piggy_id))
        from app.schemas.piggy_bank import PiggyBankEventCreate

        with pytest.raises(OperationalError):
            service.add_event(other, piggy, PiggyBankEventCreate(kind="add", amount=Decimal("10.00")))
    db_session.rollback()


# ---------- Sugestao por mes ----------


@pytest.mark.parametrize(
    ("target", "today", "expected"),
    [
        (date(2026, 3, 31), date(2026, 3, 1), 1),
        (date(2026, 4, 1), date(2026, 3, 31), 1),
        (date(2026, 12, 31), date(2026, 3, 15), 9),
        (date(2027, 3, 15), date(2026, 3, 15), 12),
        (date(2026, 3, 15), date(2026, 3, 15), 1),
    ],
)
def test_months_left(target, today, expected):
    assert service.months_left(target, today) == expected


@pytest.mark.parametrize(
    ("remaining", "target", "places", "expected"),
    [
        (Decimal("600.00"), date(2026, 9, 30), 2, Decimal("100.00")),
        (Decimal("100.00"), date(2026, 6, 30), 2, Decimal("33.34")),
        (Decimal("100"), date(2026, 6, 30), 0, Decimal("34")),
        (Decimal("50.00"), date(2026, 3, 20), 2, Decimal("50.00")),
        # A data alvo e hoje: ainda da tempo de guardar neste mes
        (Decimal("50.00"), date(2026, 3, 15), 2, Decimal("50.00")),
        (Decimal("50.00"), date(2026, 3, 14), 2, None),
        (Decimal("0"), date(2026, 9, 30), 2, None),
        (Decimal("50.00"), None, 2, None),
    ],
)
def test_suggested_per_month(remaining, target, places, expected):
    assert service.suggested_per_month(remaining, target, date(2026, 3, 15), places) == expected


def test_the_api_returns_the_suggestion_only_while_it_makes_sense(client, headers, account_id):
    far = (TODAY.replace(day=1) + timedelta(days=200)).isoformat()
    with_date = make_piggy(client, headers, account_id, name="Com data", target_date=far).json()
    no_date = make_piggy(client, headers, account_id, name="Sem data").json()
    past = make_piggy(client, headers, account_id, name="Vencido", target_date=(TODAY - timedelta(days=1)).isoformat()).json()
    assert with_date["suggested_per_month"] is not None and Decimal(with_date["suggested_per_month"]) > 0
    assert no_date["suggested_per_month"] is None and past["suggested_per_month"] is None

    # Meta atingida: nada mais a sugerir
    event(client, headers, with_date["id"], amount="600.00")
    assert get_piggy(client, headers, with_date["id"])["suggested_per_month"] is None


def test_the_suggestion_follows_what_is_left(client, headers, account_id, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 3, 15))
    piggy_id = make_piggy(client, headers, account_id, target_date="2026-09-30").json()["id"]
    # 600 em 6 meses (mar a set)
    assert get_piggy(client, headers, piggy_id)["suggested_per_month"] == "100.00"
    event(client, headers, piggy_id, amount="300.00", date="2026-03-10")
    assert get_piggy(client, headers, piggy_id)["suggested_per_month"] == "50.00"


# ---------- Consultas ----------


def test_the_list_uses_a_fixed_number_of_queries(client, headers, account_id):
    from sqlalchemy import event as sa_event

    from app.core.database import engine

    for index in range(6):
        piggy_id = make_piggy(client, headers, account_id, name=f"Cofre {index}").json()["id"]
        event(client, headers, piggy_id, amount="10.00")

    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    sa_event.listen(engine, "before_cursor_execute", count)
    try:
        assert len(client.get(URL, headers=headers).json()["items"]) == 6
    finally:
        sa_event.remove(engine, "before_cursor_execute", count)

    # Autenticacao, a pagina (contagem e itens), contas, moedas, guardado, reservado e saldos (2)
    assert len(statements) <= 12, statements

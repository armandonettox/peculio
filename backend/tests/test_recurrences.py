import asyncio
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select, text

from app.core import clock, scheduler
from app.core.database import SessionLocal
from app.models.recurrence import Recurrence
from app.models.transaction import Transaction
from app.services import recurrences as service
from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/recurrences"
TX_URL = "/api/v1/transactions"
ACCOUNTS_URL = "/api/v1/accounts"

TODAY = clock.today()


def days(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


@pytest.fixture
def account_id(client, headers):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "5000.00"}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


def template(account_id, **split_overrides):
    split = {
        "type": "withdrawal",
        "date": "2026-01-01",
        "description": "Aluguel",
        "amount": "1000.00",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Imobiliaria",
        **split_overrides,
    }
    return {"splits": [split]}


def make(client, headers, account_id, **overrides):
    body = {
        "name": "Aluguel",
        "frequency": "monthly",
        "first_date": days(0),
        "template": template(account_id),
        **overrides,
    }
    return client.post(URL, json=body, headers=headers)


def transactions(client, headers, **params):
    return client.get(TX_URL, params={"limit": 200, **params}, headers=headers).json()


def dates_of(client, headers, recurrence_id):
    rows = db_rows(recurrence_id)
    return sorted(row.recurrence_date.isoformat() for row in rows)


def db_rows(recurrence_id):
    with SessionLocal() as db:
        return db.execute(select(Transaction).where(Transaction.recurrence_id == uuid.UUID(recurrence_id))).scalars().all()


# ---------- CRUD ----------


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={}).status_code == 401
    assert client.post(f"{URL}/run").status_code == 401


def test_create_returns_the_recurrence_and_creates_todays_transaction(client, headers, account_id):
    resp = make(client, headers, account_id, name="  Aluguel ")
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Aluguel"
    assert body["frequency"] == "monthly"
    assert body["created_count"] == 1
    assert body["ended"] is False
    assert body["last_error"] is None
    assert body["active"] is True
    assert body["template"]["splits"][0]["description"] == "Aluguel"

    items = transactions(client, headers)["items"]
    assert len(items) == 1
    assert items[0]["recurrence_id"] == body["id"]
    assert items[0]["splits"][0]["date"] == days(0)


def test_a_future_first_date_creates_nothing_yet(client, headers, account_id):
    body = make(client, headers, account_id, first_date=days(10)).json()
    assert body["created_count"] == 0
    assert body["next_date"] == days(10)
    assert transactions(client, headers)["total"] == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": ""},
        {"name": "   "},
        {"frequency": "hourly"},
        {"first_date": "05/03/2026"},
        {"max_occurrences": 0},
        {"max_occurrences": 3, "end_date": "2030-01-01"},
        {"end_date": "2020-01-01"},
        {"unknown": 1},
    ],
)
def test_create_validation_returns_422(client, headers, account_id, overrides):
    assert make(client, headers, account_id, **overrides).status_code == 422


def test_create_without_template_is_422(client, headers, account_id):
    body = {"name": "X", "frequency": "monthly", "first_date": days(0)}
    assert client.post(URL, json=body, headers=headers).status_code == 422


def test_the_template_is_checked_like_a_real_transaction(client, headers, account_id):
    unknown_account = make(client, headers, account_id, template=template(str(uuid.uuid4())))
    assert unknown_account.status_code == 404 and unknown_account.json()["code"] == "account_not_found"

    wrong_currency = make(client, headers, account_id, template=template(account_id, currency_code="USD"))
    assert wrong_currency.status_code == 400 and wrong_currency.json()["code"] == "currency_mismatch"

    no_counterparty = make(client, headers, account_id, template=template(account_id, counterparty_name=None))
    assert no_counterparty.status_code == 422

    # Nada foi gravado em nenhum dos casos
    assert client.get(URL, headers=headers).json()["total"] == 0
    assert transactions(client, headers)["total"] == 0


def test_checking_the_template_leaves_no_trace_even_when_it_would_create_a_counterparty(client, headers, account_id):
    make(client, headers, account_id, first_date=days(10), template=template(account_id, counterparty_name="Nome Novo"))
    names = [a["name"] for a in client.get(ACCOUNTS_URL, headers=headers).json()["items"]]
    assert "Nome Novo" not in names


def test_list_orders_by_next_date_and_ended_last(client, headers, account_id):
    make(client, headers, account_id, name="Longe", first_date=days(30))
    make(client, headers, account_id, name="Perto", first_date=days(2))
    make(client, headers, account_id, name="Acabou", first_date=days(-1), max_occurrences=1)
    names = [r["name"] for r in client.get(URL, headers=headers).json()["items"]]
    assert names == ["Perto", "Longe", "Acabou"]


def test_list_filters_by_name_and_active(client, headers, account_id):
    make(client, headers, account_id, name="Aluguel", first_date=days(5))
    other = make(client, headers, account_id, name="Internet", first_date=days(6)).json()
    client.patch(f"{URL}/{other['id']}", json={"active": False}, headers=headers)
    assert [r["name"] for r in client.get(URL, params={"q": "ALU"}, headers=headers).json()["items"]] == ["Aluguel"]
    assert [r["name"] for r in client.get(URL, params={"active": "false"}, headers=headers).json()["items"]] == ["Internet"]
    assert client.get(URL, params={"q": "%"}, headers=headers).json()["total"] == 0


def test_other_users_recurrence_is_404(client, headers, account_id, db_session):
    recurrence_id = make(client, headers, account_id, first_date=days(5)).json()["id"]
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    for call in (
        client.get(f"{URL}/{recurrence_id}", headers=other),
        client.patch(f"{URL}/{recurrence_id}", json={"name": "X"}, headers=other),
        client.delete(f"{URL}/{recurrence_id}", headers=other),
    ):
        assert call.status_code == 404 and call.json()["code"] == "recurrence_not_found"
    assert client.get(URL, headers=other).json()["total"] == 0
    assert client.get(f"{URL}/{uuid.uuid4()}", headers=headers).status_code == 404


def test_cannot_use_another_users_account_in_the_template(client, headers, account_id, db_session):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    other_account = client.post(
        ACCOUNTS_URL, json={"name": "Dela", "type": "asset", "currency_code": "BRL"}, headers=other
    ).json()["id"]
    resp = make(client, headers, account_id, template=template(other_account))
    assert resp.status_code == 404


def test_delete_keeps_the_created_transactions(client, headers, account_id):
    recurrence = make(client, headers, account_id).json()
    assert client.delete(f"{URL}/{recurrence['id']}", headers=headers).status_code == 204
    assert client.get(f"{URL}/{recurrence['id']}", headers=headers).status_code == 404
    items = transactions(client, headers)["items"]
    assert len(items) == 1 and items[0]["recurrence_id"] is None


# ---------- Recuperar o que faltou ----------


def test_a_past_first_date_backfills_every_occurrence_with_its_own_date(client, headers, account_id):
    first = date(TODAY.year, TODAY.month, 1) - timedelta(days=62)
    body = make(client, headers, account_id, frequency="monthly", first_date=first.isoformat()).json()
    expected = []
    index = 0
    while (day := service.occurrence(first, service.RecurrenceFrequency.monthly, index)) <= TODAY:
        expected.append(day.isoformat())
        index += 1
    assert body["created_count"] == len(expected) >= 2
    assert dates_of(client, headers, body["id"]) == expected
    # Cada lancamento criado esta na data certa
    items = transactions(client, headers)["items"]
    assert sorted(i["splits"][0]["date"] for i in items) == expected


def test_catching_up_after_downtime_creates_each_missed_date(client, headers, account_id, db_session):
    body = make(client, headers, account_id, frequency="daily", first_date=days(0)).json()
    assert body["created_count"] == 1

    # O app ficou desligado por 4 dias
    created = service.run_all(db_session, TODAY + timedelta(days=4))
    assert created == 4
    assert dates_of(client, headers, body["id"]) == [(TODAY + timedelta(days=i)).isoformat() for i in range(5)]


def test_running_twice_never_duplicates(client, headers, account_id, db_session):
    body = make(client, headers, account_id, frequency="daily").json()
    later = TODAY + timedelta(days=3)
    assert service.run_all(db_session, later) == 3
    assert service.run_all(db_session, later) == 0
    assert service.run_all(db_session, later) == 0
    assert len(dates_of(client, headers, body["id"])) == 4


def test_the_database_itself_refuses_a_duplicate_date(client, headers, account_id, db_session):
    from sqlalchemy.exc import IntegrityError

    body = make(client, headers, account_id).json()
    existing = db_session.execute(select(Transaction).where(Transaction.recurrence_id == uuid.UUID(body["id"]))).scalar_one()
    db_session.add(
        Transaction(user_id=existing.user_id, recurrence_id=existing.recurrence_id, recurrence_date=existing.recurrence_date)
    )
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_two_processes_do_not_work_on_the_same_recurrence(client, headers, account_id, db_session):
    body = make(client, headers, account_id, frequency="daily", first_date=days(0)).json()
    later = TODAY + timedelta(days=2)

    # O processo A segura a linha da recorrente
    db_session.execute(select(Recurrence).where(Recurrence.id == uuid.UUID(body["id"])).with_for_update()).scalar_one()

    with SessionLocal() as other:
        # Se alguem tirar o SKIP LOCKED, este processo ficaria esperando para sempre; o limite faz o teste falhar
        other.execute(text("SET lock_timeout = '2s'"))
        assert service.run_all(other, later) == 0
    db_session.rollback()

    with SessionLocal() as other:
        assert service.run_all(other, later) == 2
    assert len(dates_of(client, headers, body["id"])) == 3


def test_a_huge_backlog_is_split_across_runs(client, headers, account_id, db_session, monkeypatch):
    monkeypatch.setattr(service, "MAX_PER_RUN", 3)
    body = make(client, headers, account_id, frequency="daily", first_date=days(0)).json()
    later = TODAY + timedelta(days=9)
    assert service.run_all(db_session, later) == 3
    assert service.run_all(db_session, later) == 3
    assert service.run_all(db_session, later) == 3
    assert service.run_all(db_session, later) == 0
    assert len(dates_of(client, headers, body["id"])) == 10


def test_the_run_endpoint_creates_what_is_missing_for_the_user_only(client, headers, account_id, db_session):
    mine = make(client, headers, account_id, first_date=days(0)).json()
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    other_account = client.post(
        ACCOUNTS_URL, json={"name": "Dela", "type": "asset", "currency_code": "BRL"}, headers=other
    ).json()["id"]
    theirs = make(client, other, other_account, first_date=days(0)).json()

    # Voltar a data da proxima ocorrencia para ontem simula um dia parado, sem esperar
    db_session.execute(
        Recurrence.__table__.update().where(Recurrence.id.in_([uuid.UUID(mine["id"]), uuid.UUID(theirs["id"])])).values(
            next_date=TODAY - timedelta(days=1), next_index=0
        )
    )
    db_session.commit()

    assert client.post(f"{URL}/run", headers=headers).json() == {"created": 1}
    # So as minhas foram processadas: a do outro usuario continua com a unica que tinha
    assert len(db_rows(mine["id"])) == 2
    assert len(db_rows(theirs["id"])) == 1


# ---------- Fim ----------


def test_max_occurrences_stops_after_that_many(client, headers, account_id, db_session):
    body = make(client, headers, account_id, frequency="daily", max_occurrences=3, first_date=days(-1)).json()
    assert body["created_count"] == 2 and body["ended"] is False

    service.run_all(db_session, TODAY + timedelta(days=30))
    refreshed = client.get(f"{URL}/{body['id']}", headers=headers).json()
    assert refreshed["created_count"] == 3
    assert refreshed["ended"] is True and refreshed["next_date"] is None
    assert len(dates_of(client, headers, body["id"])) == 3


def test_end_date_is_inclusive_and_stops_afterwards(client, headers, account_id, db_session):
    body = make(
        client, headers, account_id, frequency="daily", first_date=days(-1), end_date=days(2)
    ).json()
    service.run_all(db_session, TODAY + timedelta(days=30))
    assert dates_of(client, headers, body["id"]) == [days(-1), days(0), days(1), days(2)]
    assert client.get(f"{URL}/{body['id']}", headers=headers).json()["ended"] is True


def test_a_single_occurrence_recurrence_ends_right_away(client, headers, account_id):
    body = make(client, headers, account_id, max_occurrences=1).json()
    assert body["created_count"] == 1 and body["ended"] is True


def test_changing_the_end_rule(client, headers, account_id, db_session):
    body = make(client, headers, account_id, frequency="daily", first_date=days(-1), max_occurrences=2).json()
    assert body["ended"] is True

    # Estender o limite reabre a recorrente: a proxima data volta a existir
    extended = client.patch(f"{URL}/{body['id']}", json={"max_occurrences": 10}, headers=headers).json()
    assert extended["ended"] is False
    assert extended["created_count"] == 2

    # null tira o fim
    forever = client.patch(f"{URL}/{body['id']}", json={"max_occurrences": None}, headers=headers).json()
    assert forever["max_occurrences"] is None and forever["end_date"] is None and forever["ended"] is False


def test_end_rule_conflicts_are_refused_on_update(client, headers, account_id):
    body = make(client, headers, account_id, first_date=days(5)).json()
    both = client.patch(f"{URL}/{body['id']}", json={"max_occurrences": 3, "end_date": days(60)}, headers=headers)
    assert both.status_code == 422 and both.json()["code"] == "recurrence_invalid"
    before = client.patch(f"{URL}/{body['id']}", json={"end_date": days(-30)}, headers=headers)
    assert before.status_code == 422 and before.json()["code"] == "recurrence_invalid"


# ---------- Pausar e retomar ----------


def test_a_paused_recurrence_creates_nothing(client, headers, account_id, db_session):
    body = make(client, headers, account_id, frequency="daily", first_date=days(0)).json()
    client.patch(f"{URL}/{body['id']}", json={"active": False}, headers=headers)
    assert service.run_all(db_session, TODAY + timedelta(days=5)) == 0
    assert len(dates_of(client, headers, body["id"])) == 1


def test_editing_a_paused_recurrence_never_creates_transactions(client, headers, account_id, db_session):
    body = make(client, headers, account_id, frequency="daily", first_date=days(0)).json()
    client.patch(f"{URL}/{body['id']}", json={"active": False}, headers=headers)
    # Uma data ja vencida enquanto pausada (o app ficou parado)
    db_session.execute(
        Recurrence.__table__.update().where(Recurrence.id == uuid.UUID(body["id"])).values(next_date=TODAY - timedelta(days=1))
    )
    db_session.commit()

    renamed = client.patch(f"{URL}/{body['id']}", json={"name": "Novo nome"}, headers=headers).json()

    assert renamed["name"] == "Novo nome" and renamed["active"] is False
    assert len(dates_of(client, headers, body["id"])) == 1


def test_resuming_skips_the_paused_period_instead_of_recovering_it(client, headers, account_id, db_session):
    from app.models.user import User
    from app.schemas.recurrence import RecurrenceUpdate

    body = make(client, headers, account_id, frequency="daily", first_date=days(0)).json()
    client.patch(f"{URL}/{body['id']}", json={"active": False}, headers=headers)

    # Passam-se 5 dias parada; ao retomar, nada do periodo parado e criado
    recurrence = db_session.get(Recurrence, uuid.UUID(body["id"]))
    db_session.refresh(recurrence)
    assert recurrence.active is False
    user = db_session.get(User, recurrence.user_id)
    service.update_recurrence(db_session, user, recurrence, RecurrenceUpdate(active=True), TODAY + timedelta(days=5))
    service.process_recurrence(db_session, recurrence, TODAY + timedelta(days=5))
    db_session.commit()
    db_session.refresh(recurrence)

    assert recurrence.next_date == TODAY + timedelta(days=6)
    assert len(dates_of(client, headers, body["id"])) == 1


def test_resuming_today_keeps_todays_occurrence(client, headers, account_id):
    body = make(client, headers, account_id, frequency="daily", first_date=days(5)).json()
    client.patch(f"{URL}/{body['id']}", json={"active": False}, headers=headers)
    resumed = client.patch(f"{URL}/{body['id']}", json={"active": True}, headers=headers).json()
    assert resumed["next_date"] == days(5)
    assert resumed["created_count"] == 0


# ---------- Falhas ----------


def test_a_failing_occurrence_stops_there_and_keeps_the_reason(client, headers, account_id, db_session):
    category = client.post("/api/v1/categories", json={"name": "Moradia", "kind": "expense"}, headers=headers).json()["id"]
    body = make(
        client, headers, account_id, frequency="daily", first_date=days(1),
        template=template(account_id, category_id=category),
    ).json()
    # A categoria some depois de a recorrente ser criada
    client.delete(f"/api/v1/categories/{category}", headers=headers)

    assert service.run_all(db_session, TODAY + timedelta(days=3)) == 0
    failed = client.get(f"{URL}/{body['id']}", headers=headers).json()
    assert failed["created_count"] == 0
    assert failed["next_date"] == days(1)
    assert "ategoria" in failed["last_error"]


def test_fixing_the_template_resumes_without_skipping_any_date(client, headers, account_id, db_session):
    category = client.post("/api/v1/categories", json={"name": "Moradia", "kind": "expense"}, headers=headers).json()["id"]
    body = make(
        client, headers, account_id, frequency="daily", first_date=days(1),
        template=template(account_id, category_id=category),
    ).json()
    client.delete(f"/api/v1/categories/{category}", headers=headers)
    service.run_all(db_session, TODAY + timedelta(days=3))

    client.patch(f"{URL}/{body['id']}", json={"template": template(account_id)}, headers=headers)
    service.run_all(db_session, TODAY + timedelta(days=3))

    fixed = client.get(f"{URL}/{body['id']}", headers=headers).json()
    assert fixed["last_error"] is None
    assert dates_of(client, headers, body["id"]) == [days(1), days(2), days(3)]


def test_one_failing_recurrence_does_not_block_the_others(client, headers, account_id, db_session):
    category = client.post("/api/v1/categories", json={"name": "Moradia", "kind": "expense"}, headers=headers).json()["id"]
    bad = make(
        client, headers, account_id, name="Quebrada", first_date=days(1),
        template=template(account_id, category_id=category),
    ).json()
    good = make(client, headers, account_id, name="Boa", first_date=days(1)).json()
    client.delete(f"/api/v1/categories/{category}", headers=headers)

    assert service.run_all(db_session, TODAY + timedelta(days=1)) == 1
    assert len(dates_of(client, headers, good["id"])) == 1
    assert dates_of(client, headers, bad["id"]) == []


def test_an_unexpected_error_in_one_recurrence_does_not_stop_the_others(
    client, headers, account_id, db_session, monkeypatch
):
    first = make(client, headers, account_id, name="Quebra", frequency="daily", first_date=days(1)).json()
    second = make(client, headers, account_id, name="Boa", frequency="daily", first_date=days(1)).json()
    real = service.process_recurrence

    def explode_for_the_first(db, recurrence, today):
        if str(recurrence.id) == first["id"]:
            raise RuntimeError("falha inesperada")
        return real(db, recurrence, today)

    monkeypatch.setattr(service, "process_recurrence", explode_for_the_first)

    assert service.run_all(db_session, TODAY + timedelta(days=1)) == 1
    assert dates_of(client, headers, first["id"]) == []
    assert dates_of(client, headers, second["id"]) == [days(1)]


# ---------- O modelo nas ocorrencias ----------


def test_editing_the_template_changes_only_future_occurrences(client, headers, account_id, db_session):
    body = make(client, headers, account_id, frequency="daily", first_date=days(0)).json()
    client.patch(
        f"{URL}/{body['id']}", json={"template": template(account_id, description="Aluguel novo", amount="2000.00")},
        headers=headers,
    )
    service.run_all(db_session, TODAY + timedelta(days=1))

    items = {i["splits"][0]["date"]: i["splits"][0] for i in transactions(client, headers)["items"]}
    assert items[days(0)]["description"] == "Aluguel" and items[days(0)]["amount"] == "1000.00"
    assert items[days(1)]["description"] == "Aluguel novo" and items[days(1)]["amount"] == "2000.00"


def test_a_split_template_creates_each_line_on_every_date(client, headers, account_id, db_session):
    line = {
        "type": "withdrawal", "date": "2026-01-01", "currency_code": "BRL", "account_id": account_id,
        "counterparty_name": "Mercado",
    }
    tpl = {"title": "Compras", "splits": [{**line, "description": "Frutas", "amount": "60.00"}, {**line, "description": "Limpeza", "amount": "40.00"}]}
    body = make(client, headers, account_id, frequency="daily", template=tpl).json()
    service.run_all(db_session, TODAY + timedelta(days=1))

    items = transactions(client, headers)["items"]
    assert len(items) == 2
    for item in items:
        assert item["title"] == "Compras"
        assert [s["description"] for s in item["splits"]] == ["Frutas", "Limpeza"]
        assert {s["date"] for s in item["splits"]} == {item["splits"][0]["date"]}
    assert body["created_count"] == 1


def test_deposits_and_transfers_work_as_templates(client, headers, account_id):
    other = client.post(
        ACCOUNTS_URL, json={"name": "Poupanca", "type": "asset", "currency_code": "BRL"}, headers=headers
    ).json()["id"]
    deposit = make(
        client, headers, account_id, name="Salario",
        template=template(account_id, type="deposit", description="Salario", counterparty_name="Empresa"),
    )
    transfer = make(
        client, headers, account_id, name="Reserva",
        template=template(
            account_id, type="transfer", description="Reserva", amount="300.00",
            counterparty_name=None, counterparty_account_id=other,
        ),
    )
    assert deposit.status_code == 201 and transfer.status_code == 201
    # 5000 + 1000 de salario - 300 transferidos
    assert client.get(f"{ACCOUNTS_URL}/{account_id}", headers=headers).json()["balance"] == "5700.00"
    assert client.get(f"{ACCOUNTS_URL}/{other}", headers=headers).json()["balance"] == "300.00"


def test_occurrences_link_to_budget_and_auto_match_bills(client, headers, account_id, db_session):
    budget = client.post(
        "/api/v1/budgets", json={"name": "Moradia", "currency_code": "BRL", "amount": "3000.00", "period": "monthly"},
        headers=headers,
    ).json()["id"]
    bill = client.post(
        "/api/v1/bills",
        json={"name": "Aluguel conta", "currency_code": "BRL", "amount_min": "900.00", "amount_max": "1100.00",
              "match_text": "aluguel", "first_due_date": days(-1), "frequency": "monthly"},
        headers=headers,
    ).json()["id"]
    make(client, headers, account_id, template=template(account_id, budget_id=budget))

    split = transactions(client, headers)["items"][0]["splits"][0]
    assert split["budget_id"] == budget
    # bill_id nao veio no modelo: o servidor liga sozinho, como num lancamento digitado
    assert split["bill_id"] == bill


def test_an_explicit_null_bill_in_the_template_is_respected(client, headers, account_id):
    client.post(
        "/api/v1/bills",
        json={"name": "Aluguel conta", "currency_code": "BRL", "amount_min": "900.00", "amount_max": "1100.00",
              "match_text": "aluguel", "first_due_date": days(-1), "frequency": "monthly"},
        headers=headers,
    )
    make(client, headers, account_id, template=template(account_id, bill_id=None))
    assert transactions(client, headers)["items"][0]["splits"][0]["bill_id"] is None


def test_balance_follows_the_created_transactions(client, headers, account_id, db_session):
    make(client, headers, account_id, frequency="daily", first_date=days(0))
    service.run_all(db_session, TODAY + timedelta(days=2))
    balance = client.get(f"{ACCOUNTS_URL}/{account_id}", headers=headers).json()["balance"]
    assert balance == "2000.00"


# ---------- O laco de fundo ----------


def test_one_round_of_the_loop_creates_what_is_missing(client, headers, account_id):
    body = make(client, headers, account_id, frequency="daily", first_date=days(0)).json()
    assert scheduler.run_recurrences_once(TODAY + timedelta(days=2)) == 2
    assert scheduler.run_recurrences_once(TODAY + timedelta(days=2)) == 0
    assert len(dates_of(client, headers, body["id"])) == 3


def test_the_loop_keeps_going_after_a_round_fails(monkeypatch):
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("banco indisponivel")
        return 0

    monkeypatch.setattr(scheduler, "run_recurrences_once", flaky)

    async def run():
        task = asyncio.create_task(scheduler.recurrence_loop(0))
        for _ in range(100):
            if len(calls) >= 3:
                break
            await asyncio.sleep(0.01)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(run())
    assert len(calls) >= 3


def test_the_scheduler_only_starts_when_enabled(monkeypatch):
    async def run(enabled):
        monkeypatch.setattr(scheduler.settings, "recurrence_scheduler_enabled", enabled)
        task = scheduler.start_scheduler()
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        return task

    assert asyncio.run(run(False)) is None
    assert asyncio.run(run(True)) is not None

"""Alerta de orcamento: o webhook budget.alert avisa uma vez por cruzamento (80% e 100%) em cada periodo."""

import pytest
from sqlalchemy import select

from app.models.budget import Budget
from app.models.webhook import WebhookDelivery
from tests.conftest import auth_headers, register
from tests.test_budgets import URL, make_account, make_budget, spend
from tests.webhook_support import no_real_dns  # noqa: F401

WEBHOOKS = "/api/v1/webhooks"
TX = "/api/v1/transactions"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


@pytest.fixture
def listener(client, headers):
    created = client.post(
        WEBHOOKS,
        json={"name": "Alertas", "url": "https://hooks.example.com/alertas", "events": ["budget.alert"]},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


def alerts(db_session):
    db_session.expire_all()
    rows = db_session.execute(select(WebhookDelivery).where(WebhookDelivery.event == "budget.alert")).scalars().all()
    return sorted((row.payload["data"] for row in rows), key=lambda data: data["percent"])


def budget_with_alert(client, headers, **overrides):
    # Mensal de 1.000,00: 80% = 800,00 e 100% = 1.000,00
    body = {"name": "Mercado", "amount": "1000.00", "alert": True, **overrides}
    resp = make_budget(client, headers, **body)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def pay(client, headers, account, budget_id, amount, on):
    resp = spend(client, headers, account, budget_id, amount=amount, on=on)
    assert resp.status_code == 201, resp.text
    return resp.json()


def current_month_day(day=10):
    from app.core import clock

    return clock.today().replace(day=day).isoformat()


def test_the_event_can_be_subscribed_to(client, headers):
    resp = client.post(
        WEBHOOKS, json={"name": "A", "url": "https://hooks.example.com/a", "events": ["budget.alert"]}, headers=headers
    )
    assert resp.status_code == 201 and resp.json()["events"] == ["budget.alert"]


def test_crossing_80_percent_sends_a_warning(client, headers, listener, db_session):
    account = make_account(client, headers)
    budget_id = budget_with_alert(client, headers)

    pay(client, headers, account, budget_id, "700.00", current_month_day())
    assert alerts(db_session) == []

    pay(client, headers, account, budget_id, "150.00", current_month_day())
    sent = alerts(db_session)
    assert len(sent) == 1
    assert sent[0]["level"] == "warning"
    assert (sent[0]["percent"], sent[0]["spent"], sent[0]["limit"]) == (85, "850.00", "1000.00")
    assert sent[0]["budget"]["name"] == "Mercado" and sent[0]["budget"]["id"] == budget_id


def test_each_level_warns_once_and_more_spending_does_not_repeat_it(client, headers, listener, db_session):
    account = make_account(client, headers)
    budget_id = budget_with_alert(client, headers)

    pay(client, headers, account, budget_id, "850.00", current_month_day())
    pay(client, headers, account, budget_id, "10.00", current_month_day())
    assert [data["level"] for data in alerts(db_session)] == ["warning"]

    pay(client, headers, account, budget_id, "140.00", current_month_day())
    pay(client, headers, account, budget_id, "300.00", current_month_day())
    assert [data["level"] for data in alerts(db_session)] == ["warning", "over"]


def test_jumping_straight_over_the_limit_sends_only_the_over_alert(client, headers, listener, db_session):
    account = make_account(client, headers)
    budget_id = budget_with_alert(client, headers)
    pay(client, headers, account, budget_id, "1200.00", current_month_day())
    assert [data["level"] for data in alerts(db_session)] == ["over"]


def test_a_budget_without_alert_sends_nothing(client, headers, listener, db_session):
    account = make_account(client, headers)
    budget_id = budget_with_alert(client, headers, alert=False)
    pay(client, headers, account, budget_id, "1200.00", current_month_day())
    assert alerts(db_session) == []


def test_turning_the_alert_on_does_not_warn_about_what_already_happened(client, headers, listener, db_session):
    account = make_account(client, headers)
    budget_id = budget_with_alert(client, headers, alert=False)
    pay(client, headers, account, budget_id, "900.00", current_month_day())

    assert client.patch(f"{URL}/{budget_id}", json={"alert": True}, headers=headers).status_code == 200
    assert alerts(db_session) == []
    # Mais gasto no mesmo nivel nao avisa; passar do limite avisa
    pay(client, headers, account, budget_id, "20.00", current_month_day())
    assert alerts(db_session) == []
    pay(client, headers, account, budget_id, "200.00", current_month_day())
    assert [data["level"] for data in alerts(db_session)] == ["over"]


def test_spending_that_drops_lets_the_next_crossing_warn_again(client, headers, listener, db_session):
    account = make_account(client, headers)
    budget_id = budget_with_alert(client, headers)

    big = pay(client, headers, account, budget_id, "900.00", current_month_day())
    assert [data["level"] for data in alerts(db_session)] == ["warning"]

    assert client.delete(f"{TX}/{big['id']}", headers=headers).status_code == 204
    pay(client, headers, account, budget_id, "100.00", current_month_day())
    assert len(alerts(db_session)) == 1

    pay(client, headers, account, budget_id, "750.00", current_month_day())
    assert [data["level"] for data in alerts(db_session)] == ["warning", "warning"]


def test_a_new_period_starts_over(client, headers, listener, db_session):
    account = make_account(client, headers)
    budget_id = budget_with_alert(client, headers)
    pay(client, headers, account, budget_id, "900.00", current_month_day())
    assert len(alerts(db_session)) == 1

    # Simula a virada do mes: o periodo guardado e o do mes passado
    budget = db_session.get(Budget, __import__("uuid").UUID(budget_id))
    from datetime import date

    budget.alert_period_start = date(2020, 1, 1)
    db_session.commit()

    pay(client, headers, account, budget_id, "5.00", current_month_day())
    assert len(alerts(db_session)) == 2


def test_category_spending_counts_toward_the_alert(client, headers, listener, db_session):
    category = client.post(
        "/api/v1/categories", json={"name": "Mercado", "kind": "expense", "color": "#00A878", "icon": "house"}, headers=headers
    ).json()["id"]
    account = make_account(client, headers)
    budget_with_alert(client, headers, category_ids=[category])
    resp = spend(client, headers, account, None, amount="900.00", on=current_month_day(), category_id=category)
    assert resp.status_code == 201
    assert [data["level"] for data in alerts(db_session)] == ["warning"]


def test_an_expired_custom_budget_does_not_alert(client, headers, listener, db_session):
    account = make_account(client, headers)
    budget_id = budget_with_alert(client, headers, period="custom", start_date="2020-01-01", end_date="2020-01-31")
    pay(client, headers, account, budget_id, "1500.00", "2020-01-10")
    assert alerts(db_session) == []


def test_only_webhooks_subscribed_to_the_event_receive_it(client, headers, db_session):
    created = client.post(
        WEBHOOKS,
        json={"name": "So lancamentos", "url": "https://hooks.example.com/x", "events": ["transaction.created"]},
        headers=headers,
    )
    assert created.status_code == 201
    account = make_account(client, headers)
    budget_id = budget_with_alert(client, headers)
    pay(client, headers, account, budget_id, "900.00", current_month_day())
    assert alerts(db_session) == []


def test_alerts_stay_with_the_budget_owner(client, headers, listener, db_session):
    from tests.conftest import make_user

    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    other_account = make_account(client, other)
    other_budget = budget_with_alert(client, other)
    pay(client, other, other_account, other_budget, "900.00", current_month_day())
    # O webhook do primeiro usuario nao recebe o alerta do orcamento da outra pessoa
    assert alerts(db_session) == []

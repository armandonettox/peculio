"""Alerta do planejamento mensal: o webhook budget.alert (source monthly_plan) avisa uma vez por cruzamento em cada limite."""

import pytest
from sqlalchemy import select

from app.core import clock
from app.models.monthly_plan import MonthlyPlanItem
from app.models.webhook import WebhookDelivery
from tests.conftest import auth_headers, make_user, register
from tests.test_monthly_plan import account, category, create, spend
from tests.webhook_support import no_real_dns  # noqa: F401

WEBHOOKS = "/api/v1/webhooks"
URL = "/api/v1/plans/monthly"
TX = "/api/v1/transactions"


def this_month():
    return clock.today().replace(day=1)


def on_day(day=10):
    return this_month().replace(day=day).isoformat()


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


def alerts(db_session):
    db_session.expire_all()
    rows = db_session.execute(select(WebhookDelivery).where(WebhookDelivery.event == "budget.alert")).scalars().all()
    return sorted((row.payload["data"] for row in rows), key=lambda data: (data["percent"], data["level"]))


def plan_with_alert(client, headers, cat, amount="1000.00", alert=True):
    resp = create(client, headers, month=this_month().strftime("%Y-%m"), items=[{"category_id": cat, "amount": amount, "alert": alert}])
    assert resp.status_code == 201, resp.text
    return resp.json()


def pay(client, headers, acct, cat, amount, day=10):
    return spend(client, headers, acct, amount=amount, on=on_day(day), category_id=cat)


def test_crossing_80_percent_sends_a_warning_with_the_category(client, headers, listener, db_session):
    cat = category(client, headers, "Casa")
    acct = account(client, headers)
    plan_with_alert(client, headers, cat)

    pay(client, headers, acct, cat, "700.00")
    assert alerts(db_session) == []

    pay(client, headers, acct, cat, "150.00")
    sent = alerts(db_session)
    assert len(sent) == 1
    data = sent[0]
    assert (data["source"], data["level"], data["percent"]) == ("monthly_plan", "warning", 85)
    assert data["category"] == {"id": cat, "name": "Casa"}
    assert (data["limit"], data["spent"], data["remaining"]) == ("1000.00", "850.00", "150.00")
    assert data["month"] == this_month().isoformat() and data["currency_code"] == "BRL"


def test_each_level_warns_once(client, headers, listener, db_session):
    cat = category(client, headers, "Casa")
    acct = account(client, headers)
    plan_with_alert(client, headers, cat)

    pay(client, headers, acct, cat, "850.00")
    pay(client, headers, acct, cat, "10.00")
    assert [data["level"] for data in alerts(db_session)] == ["warning"]

    # Chegar exatamente no limite ainda nao passou dele (mesmo criterio do selo da tabela)
    pay(client, headers, acct, cat, "140.00")
    assert [data["level"] for data in alerts(db_session)] == ["warning"]

    pay(client, headers, acct, cat, "1.00")
    pay(client, headers, acct, cat, "300.00")
    assert sorted(data["level"] for data in alerts(db_session)) == ["over", "warning"]


def test_a_limit_without_alert_sends_nothing(client, headers, listener, db_session):
    cat = category(client, headers, "Casa")
    acct = account(client, headers)
    plan_with_alert(client, headers, cat, alert=False)
    pay(client, headers, acct, cat, "1500.00")
    assert alerts(db_session) == []


def test_only_alert_limits_warn_when_a_plan_has_several(client, headers, listener, db_session):
    casa, lazer = category(client, headers, "Casa"), category(client, headers, "Lazer")
    acct = account(client, headers)
    resp = create(
        client,
        headers,
        month=this_month().strftime("%Y-%m"),
        items=[{"category_id": casa, "amount": "1000.00", "alert": True}, {"category_id": lazer, "amount": "100.00"}],
    )
    assert resp.status_code == 201
    pay(client, headers, acct, lazer, "500.00")
    assert alerts(db_session) == []
    pay(client, headers, acct, casa, "900.00")
    assert [data["category"]["name"] for data in alerts(db_session)] == ["Casa"]


def test_turning_the_alert_on_does_not_warn_about_what_already_happened(client, headers, listener, db_session):
    cat = category(client, headers, "Casa")
    acct = account(client, headers)
    month = this_month().strftime("%Y-%m")
    plan_with_alert(client, headers, cat, alert=False)
    pay(client, headers, acct, cat, "900.00")

    resp = client.put(f"{URL}/{month}/items", json={"items": [{"category_id": cat, "amount": "1000.00", "alert": True}]}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert alerts(db_session) == []
    pay(client, headers, acct, cat, "20.00")
    assert alerts(db_session) == []
    pay(client, headers, acct, cat, "200.00")
    assert [data["level"] for data in alerts(db_session)] == ["over"]


def test_spending_that_drops_lets_the_next_crossing_warn_again(client, headers, listener, db_session):
    cat = category(client, headers, "Casa")
    acct = account(client, headers)
    plan_with_alert(client, headers, cat)

    big = pay(client, headers, acct, cat, "900.00")
    assert len(alerts(db_session)) == 1
    assert client.delete(f"{TX}/{big['id']}", headers=headers).status_code == 204
    pay(client, headers, acct, cat, "100.00")
    assert len(alerts(db_session)) == 1
    pay(client, headers, acct, cat, "750.00")
    assert len(alerts(db_session)) == 2


def test_only_the_plan_of_the_current_month_alerts(client, headers, listener, db_session):
    cat = category(client, headers, "Casa")
    acct = account(client, headers)
    # Plano de um mes que ja passou, com alerta ligado e gasto acima do limite
    resp = create(client, headers, month="2020-01", items=[{"category_id": cat, "amount": "100.00", "alert": True}])
    assert resp.status_code == 201
    spend(client, headers, acct, amount="500.00", on="2020-01-10", category_id=cat)
    assert alerts(db_session) == []


def test_copying_the_previous_month_does_not_warn_about_spending_already_there(client, headers, listener, db_session):
    cat = category(client, headers, "Casa")
    acct = account(client, headers)
    today = this_month()
    previous = (today.replace(day=1) - __import__("datetime").timedelta(days=1)).replace(day=1)
    resp = create(client, headers, month=previous.strftime("%Y-%m"), items=[{"category_id": cat, "amount": "1000.00", "alert": True}])
    assert resp.status_code == 201
    pay(client, headers, acct, cat, "900.00")

    copied = client.post(f"{URL}/{today.strftime('%Y-%m')}/copy-previous", headers=headers)
    assert copied.status_code == 201, copied.text
    assert alerts(db_session) == []
    pay(client, headers, acct, cat, "200.00")
    assert [data["level"] for data in alerts(db_session)] == ["over"]


def test_the_stored_level_starts_at_none_and_follows_the_spending(client, headers, listener, db_session):
    cat = category(client, headers, "Casa")
    acct = account(client, headers)
    plan_with_alert(client, headers, cat)
    pay(client, headers, acct, cat, "900.00")
    db_session.expire_all()
    item = db_session.execute(select(MonthlyPlanItem)).scalars().one()
    assert item.alert_level.value == "warning"


def test_only_webhooks_subscribed_to_the_event_receive_it(client, headers, db_session):
    created = client.post(
        WEBHOOKS,
        json={"name": "So lancamentos", "url": "https://hooks.example.com/x", "events": ["transaction.created"]},
        headers=headers,
    )
    assert created.status_code == 201
    cat = category(client, headers, "Casa")
    acct = account(client, headers)
    plan_with_alert(client, headers, cat)
    pay(client, headers, acct, cat, "900.00")
    assert alerts(db_session) == []


def test_alerts_stay_with_the_plan_owner(client, headers, listener, db_session):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    cat = category(client, other, "Casa")
    acct = account(client, other)
    plan_with_alert(client, other, cat)
    pay(client, other, acct, cat, "900.00")
    assert alerts(db_session) == []

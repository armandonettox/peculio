from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

from app.core import clock
from app.core.config import Settings
from tests.conftest import auth_headers, register


@pytest.mark.parametrize(
    ("utc", "zone", "expected"),
    [
        # Madrugada em UTC ainda e "ontem" no Brasil
        (datetime(2026, 3, 15, 1, 0, tzinfo=timezone.utc), "America/Sao_Paulo", date(2026, 3, 14)),
        (datetime(2026, 3, 15, 1, 0, tzinfo=timezone.utc), "UTC", date(2026, 3, 15)),
        (datetime(2026, 3, 15, 2, 59, tzinfo=timezone.utc), "America/Sao_Paulo", date(2026, 3, 14)),
        (datetime(2026, 3, 15, 3, 0, tzinfo=timezone.utc), "America/Sao_Paulo", date(2026, 3, 15)),
        # Noite em UTC ja e "amanha" no Japao
        (datetime(2026, 3, 15, 23, 0, tzinfo=timezone.utc), "Asia/Tokyo", date(2026, 3, 16)),
        (datetime(2026, 3, 15, 23, 0, tzinfo=timezone.utc), "America/Sao_Paulo", date(2026, 3, 15)),
    ],
)
def test_today_follows_the_app_timezone(monkeypatch, utc, zone, expected):
    monkeypatch.setattr(clock.settings, "app_timezone", zone)
    assert clock.today(utc) == expected


def test_today_without_arguments_uses_the_current_moment(monkeypatch):
    monkeypatch.setattr(clock.settings, "app_timezone", "UTC")
    assert abs((clock.today() - datetime.now(timezone.utc).date()).days) <= 1


def test_the_default_timezone_is_brazil():
    assert Settings.model_fields["app_timezone"].default == "America/Sao_Paulo"


def test_an_invalid_timezone_is_refused_at_startup():
    with pytest.raises(ValidationError):
        Settings(app_timezone="Marte/Base")


def test_the_recurrence_endpoint_uses_the_app_clock_not_the_machine_clock(client, monkeypatch):
    register(client)
    headers = auth_headers(client)
    account_id = client.post(
        "/api/v1/accounts", json={"name": "Nubank", "type": "asset", "currency_code": "BRL"}, headers=headers
    ).json()["id"]

    monkeypatch.setattr(clock.settings, "app_timezone", "Pacific/Kiritimati")
    ahead_today = clock.today()
    body = {
        "name": "Diaria",
        "frequency": "daily",
        "first_date": ahead_today.isoformat(),
        "template": {
            "splits": [
                {
                    "type": "withdrawal", "date": "2026-01-01", "description": "x", "amount": "1.00",
                    "currency_code": "BRL", "account_id": account_id, "counterparty_name": "Loja",
                }
            ]
        },
    }

    # Num fuso atrasado (UTC-11) a data do fuso adiantado (UTC+14) ainda esta no futuro: nada e criado
    monkeypatch.setattr(clock.settings, "app_timezone", "Pacific/Pago_Pago")
    assert client.post("/api/v1/recurrences", json=body, headers=headers).json()["created_count"] == 0

    # No proprio fuso adiantado o dia ja chegou
    monkeypatch.setattr(clock.settings, "app_timezone", "Pacific/Kiritimati")
    body["name"] = "Diaria 2"
    assert client.post("/api/v1/recurrences", json=body, headers=headers).json()["created_count"] == 1

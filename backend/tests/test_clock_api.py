from datetime import date, datetime, timedelta, timezone

import pytest

from app.core import clock
from app.core.config import settings
from tests.conftest import auth_headers, register

URL = "/api/v1/clock"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def fix_now(monkeypatch, moment: datetime, tz: str = "America/Sao_Paulo"):
    monkeypatch.setattr(clock, "utc_now", lambda: moment)
    monkeypatch.setattr(settings, "app_timezone", tz)


def utc(year, month, day, hour=0, minute=0, second=0):
    return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)


def test_requires_login(client):
    assert client.get(URL).status_code == 401


def test_returns_now_in_utc_the_app_timezone_and_today(client, headers):
    response = client.get(URL, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["timezone"] == settings.app_timezone
    moment = datetime.fromisoformat(body["now"])
    assert moment.utcoffset() == timedelta(0)
    assert abs((datetime.now(timezone.utc) - moment).total_seconds()) < 10
    assert date.fromisoformat(body["today"]) == clock.today()


@pytest.mark.parametrize(
    ("moment", "tz", "expected"),
    [
        # Sao Paulo e UTC-3: meia-noite local e 03:00 UTC
        (utc(2026, 3, 12, 2, 59, 59), "America/Sao_Paulo", "2026-03-11"),
        (utc(2026, 3, 12, 3, 0, 0), "America/Sao_Paulo", "2026-03-12"),
        (utc(2026, 3, 12, 0, 0, 0), "America/Sao_Paulo", "2026-03-11"),
        (utc(2026, 3, 12, 23, 59, 59), "America/Sao_Paulo", "2026-03-12"),
        # Toquio e UTC+9: no fim do dia em UTC ja e o dia seguinte la
        (utc(2026, 3, 12, 14, 59, 59), "Asia/Tokyo", "2026-03-12"),
        (utc(2026, 3, 12, 15, 0, 0), "Asia/Tokyo", "2026-03-13"),
        # Viradas de mes, de ano e ano bissexto
        (utc(2026, 1, 1, 2, 59, 59), "America/Sao_Paulo", "2025-12-31"),
        (utc(2028, 3, 1, 2, 59, 59), "America/Sao_Paulo", "2028-02-29"),
        (utc(2026, 2, 28, 23, 0, 0), "UTC", "2026-02-28"),
        (utc(2026, 12, 31, 23, 59, 59), "Pacific/Auckland", "2027-01-01"),
    ],
)
def test_today_follows_the_app_timezone_not_the_machine_one(client, headers, monkeypatch, moment, tz, expected):
    fix_now(monkeypatch, moment, tz)
    body = client.get(URL, headers=headers).json()
    assert body["today"] == expected
    assert body["timezone"] == tz
    assert datetime.fromisoformat(body["now"]) == moment


def test_the_same_instant_is_a_different_day_in_two_timezones(client, headers, monkeypatch):
    moment = utc(2026, 6, 15, 1, 30)
    fix_now(monkeypatch, moment, "America/Sao_Paulo")
    saopaulo = client.get(URL, headers=headers).json()["today"]
    fix_now(monkeypatch, moment, "Asia/Tokyo")
    tokyo = client.get(URL, headers=headers).json()["today"]
    assert (saopaulo, tokyo) == ("2026-06-14", "2026-06-15")


def test_now_is_serialized_with_an_explicit_utc_offset(client, headers, monkeypatch):
    fix_now(monkeypatch, utc(2026, 3, 12, 12, 0, 0))
    raw = client.get(URL, headers=headers).json()["now"]
    assert raw.endswith("Z") or raw.endswith("+00:00")


def test_today_helper_still_accepts_an_explicit_instant(monkeypatch):
    monkeypatch.setattr(settings, "app_timezone", "America/Sao_Paulo")
    assert clock.today(utc(2026, 3, 12, 2, 0)) == date(2026, 3, 11)
    assert clock.today(utc(2026, 3, 12, 3, 0)) == date(2026, 3, 12)

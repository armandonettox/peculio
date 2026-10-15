from datetime import date, datetime, timedelta, timezone

from app.core import clock
from tests.conftest import SESSION_TODAY


# Guarda a funcao congelada vista pelo primeiro teste, para o ultimo conferir que ela foi desfeita
FROZEN_FUNCTIONS = []


def test_frozen_today_ignores_the_clock_moving_past_midnight(frozen_today, monkeypatch):
    FROZEN_FUNCTIONS.append(clock.today)
    real_utc_now = clock.utc_now
    # Tres dias depois: e o que o CI "viveu" ao cruzar a meia-noite do fuso do app, so que mais exagerado
    monkeypatch.setattr(clock, "utc_now", lambda: real_utc_now() + timedelta(days=3))
    assert clock.today() == SESSION_TODAY == frozen_today


def test_without_the_fixture_the_app_clock_follows_the_moment(monkeypatch):
    real_utc_now = clock.utc_now
    monkeypatch.setattr(clock, "utc_now", lambda: real_utc_now() + timedelta(days=3))
    # Sem congelar, o app enxerga o dia novo e a data lida no import ficaria para tras
    assert clock.today() > SESSION_TODAY


def test_an_explicit_moment_still_goes_through_the_real_clock(frozen_today):
    # 02:00 UTC de 15/03 ainda e 23:00 de 14/03 em Sao Paulo (UTC-3)
    moment = datetime(2026, 3, 15, 2, 0, tzinfo=timezone.utc)
    assert clock.today(moment) == date(2026, 3, 14)


def test_the_fixture_is_undone_after_each_test():
    # Roda sem a fixture, depois do primeiro teste: o relogio nao pode continuar sendo a funcao congelada dele
    assert FROZEN_FUNCTIONS, "o primeiro teste deste arquivo precisa ter rodado antes"
    assert clock.today is not FROZEN_FUNCTIONS[0]

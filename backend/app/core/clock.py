from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.core.config import settings


def utc_now() -> datetime:
    """O instante atual em UTC (com fuso). Fica aqui para os testes fixarem um instante so."""
    return datetime.now(timezone.utc)


def today(now: datetime | None = None) -> date:
    """O dia de hoje no fuso do app (`APP_TIMEZONE`), nao o do relogio da maquina. No Docker a maquina
    costuma estar em UTC; sem isto, a noite no Brasil o servidor ja estaria "no dia seguinte" e uma
    recorrente criaria o lancamento de amanha antes da hora. `now` existe so para os testes."""
    moment = now if now is not None else utc_now()
    return moment.astimezone(ZoneInfo(settings.app_timezone)).date()

from datetime import date as DateType
from datetime import datetime

from pydantic import BaseModel


class ClockOut(BaseModel):
    """O relogio do app. O frontend usa isto para calcular o "hoje" igual ao do servidor, sem depender
    do fuso nem do relogio do aparelho."""

    # Instante atual, em UTC
    now: datetime
    # Fuso do app (APP_TIMEZONE), nome IANA ("America/Sao_Paulo")
    timezone: str
    # O dia de hoje nesse fuso
    today: DateType

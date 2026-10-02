import asyncio
import logging
from datetime import date

from app.core import clock
from app.core.config import settings
from app.core.database import SessionLocal
from app.services import recurrences

logger = logging.getLogger("finance-app.scheduler")


def run_recurrences_once(today: date | None = None) -> int:
    """Uma rodada: cria os lancamentos que faltam das recorrentes de todos os usuarios."""
    with SessionLocal() as db:
        return recurrences.run_all(db, today or clock.today())


async def recurrence_loop(interval_seconds: int) -> None:
    """Roda ao subir e depois a cada `interval_seconds`. Um erro numa rodada nao derruba o laco."""
    while True:
        try:
            created = await asyncio.to_thread(run_recurrences_once)
            if created:
                logger.info("Recorrentes: %s lancamento(s) criado(s)", created)
        except Exception:
            logger.exception("Falha na rodada das recorrentes")
        await asyncio.sleep(interval_seconds)


def start_scheduler() -> asyncio.Task | None:
    if not settings.recurrence_scheduler_enabled:
        return None
    return asyncio.create_task(recurrence_loop(settings.recurrence_interval_seconds))

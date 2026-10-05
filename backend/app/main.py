import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.core.errors import register_error_handlers
from app.core.rate_limit import limiter
from app.core.scheduler import start_scheduler
from app.core.upload_limit import UploadSizeLimitMiddleware
from app.routers import (
    accounts,
    api_tokens,
    attachments,
    auth,
    bills,
    budgets,
    rules,
    categories,
    clock,
    currencies,
    dashboard,
    envelopes,
    imports,
    instance,
    invites,
    piggy_banks,
    reconciliation,
    recurrences,
    reports,
    saved_reports,
    tags,
    transactions,
    two_factor,
    webhooks,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Laco que cria os lancamentos das recorrentes enquanto o app estiver no ar
    task = start_scheduler()
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="Pecúlio", version="0.1.0", lifespan=lifespan)

app.state.limiter = limiter
register_error_handlers(app)
# Mais interno de todos: o 413 cedo passa pelo CORS e o corte em partes cai no tratador de erros
app.add_middleware(UploadSizeLimitMiddleware)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(auth.router)
api_v1.include_router(two_factor.router)
api_v1.include_router(invites.router)
api_v1.include_router(currencies.router)
api_v1.include_router(accounts.router)
api_v1.include_router(categories.router)
api_v1.include_router(tags.router)
api_v1.include_router(budgets.router)
api_v1.include_router(envelopes.router)
api_v1.include_router(reconciliation.router)
api_v1.include_router(saved_reports.router)
api_v1.include_router(rules.router)
api_v1.include_router(bills.router)
api_v1.include_router(recurrences.router)
api_v1.include_router(piggy_banks.router)
api_v1.include_router(transactions.router)
api_v1.include_router(webhooks.router)
api_v1.include_router(reports.router)
api_v1.include_router(attachments.router)
api_v1.include_router(imports.router)
api_v1.include_router(api_tokens.router)
api_v1.include_router(dashboard.router)
api_v1.include_router(clock.router)
api_v1.include_router(instance.router)
app.include_router(api_v1)
# Fora do /api: o padrao security.txt pede o caminho /.well-known/security.txt na raiz
app.include_router(instance.well_known_router)


@app.get("/api/health")
def health() -> dict:
    # Usado pelo docker compose e pelo frontend para saber se a API esta no ar
    return {"status": "ok"}

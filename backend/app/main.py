import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.core.errors import register_error_handlers
from app.core.rate_limit import limiter
from app.core.scheduler import start_scheduler
from app.routers import (
    accounts,
    auth,
    bills,
    budgets,
    categories,
    currencies,
    invites,
    recurrences,
    tags,
    transactions,
    two_factor,
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


app = FastAPI(title="finance-app", version="0.1.0", lifespan=lifespan)

app.state.limiter = limiter
register_error_handlers(app)
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
api_v1.include_router(bills.router)
api_v1.include_router(recurrences.router)
api_v1.include_router(transactions.router)
app.include_router(api_v1)


@app.get("/api/health")
def health() -> dict:
    # Usado pelo docker compose e pelo frontend para saber se a API esta no ar
    return {"status": "ok"}

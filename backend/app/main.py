from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.core.errors import register_error_handlers
from app.core.rate_limit import limiter
from app.routers import accounts, auth, currencies, invites

app = FastAPI(title="finance-app", version="0.1.0")

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
api_v1.include_router(invites.router)
api_v1.include_router(currencies.router)
api_v1.include_router(accounts.router)
app.include_router(api_v1)


@app.get("/api/health")
def health() -> dict:
    # Usado pelo docker compose e pelo frontend para saber se a API esta no ar
    return {"status": "ok"}

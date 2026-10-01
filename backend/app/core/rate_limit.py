from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings


def client_key(request: Request) -> str:
    # Atras de um proxy confiavel o IP real vem no X-Forwarded-For. Sem o proxy, usar o
    # header deixaria o cliente forjar o proprio IP, entao so le quando a config permite.
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(key_func=client_key, default_limits=["100/minute"])

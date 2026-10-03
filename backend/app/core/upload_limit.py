"""Recusa envio de anexo ou de extrato grande antes de receber o corpo inteiro.

Sem isso o Starlette le todo o multipart (em disco temporario) antes de a rota poder responder
413. Aqui o tamanho declarado no Content-Length recusa na hora, e quando o cliente nao declara
(corpo em partes) a leitura e cortada assim que passa do limite.
"""

import json
import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.core.errors import AppError, ErrorCode

UPLOAD_PATH = re.compile(r"^/api/v1/transactions/[^/]+/attachments/?$")
IMPORT_PATH = re.compile(r"^/api/v1/imports/preview/?$")
# O multipart acrescenta fronteiras e cabecalhos ao arquivo; esta folga evita recusar um arquivo
# que cabe no limite. O limite exato do arquivo continua sendo conferido pela rota.
MULTIPART_OVERHEAD = 64 * 1024


def _rule_for(path: str) -> tuple[int, ErrorCode] | None:
    """Limite de bytes e codigo de erro do envio neste caminho, ou None se o caminho nao recebe arquivo."""
    if UPLOAD_PATH.match(path):
        return settings.attachment_max_bytes, ErrorCode.ATTACHMENT_TOO_LARGE
    if IMPORT_PATH.match(path):
        return settings.import_max_bytes, ErrorCode.IMPORT_FILE_TOO_LARGE
    return None


def _limit_message(max_bytes: int) -> str:
    limit_mb = max_bytes // (1024 * 1024)
    return f"O arquivo passa do limite de {limit_mb} MB"


class UploadSizeLimitMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        rule = _rule_for(scope["path"]) if scope["type"] == "http" and scope["method"] == "POST" else None
        if rule is None:
            await self.app(scope, receive, send)
            return

        max_bytes, code = rule
        limit = max_bytes + MULTIPART_OVERHEAD
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await self._refuse(send, max_bytes, code)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # O AppError sobe ate o tratador de erros da API e vira a mesma resposta 413 da rota
                    raise AppError(413, code, _limit_message(max_bytes))
            return message

        await self.app(scope, limited_receive, send)

    async def _refuse(self, send: Send, max_bytes: int, code: ErrorCode) -> None:
        body = json.dumps({"detail": _limit_message(max_bytes), "code": code.value}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    # O corpo nao foi lido: fecha a conexao em vez de reaproveita-la
                    (b"connection", b"close"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

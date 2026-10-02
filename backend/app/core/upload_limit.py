"""Recusa envio de anexo grande antes de receber o corpo inteiro.

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
# O multipart acrescenta fronteiras e cabecalhos ao arquivo; esta folga evita recusar um arquivo
# que cabe no limite. O limite exato do arquivo continua sendo conferido pela rota.
MULTIPART_OVERHEAD = 64 * 1024


def _limit_message() -> str:
    limit_mb = settings.attachment_max_bytes // (1024 * 1024)
    return f"O arquivo passa do limite de {limit_mb} MB"


class UploadSizeLimitMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or not UPLOAD_PATH.match(scope["path"]):
            await self.app(scope, receive, send)
            return

        limit = settings.attachment_max_bytes + MULTIPART_OVERHEAD
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await self._refuse(send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # O AppError sobe ate o tratador de erros da API e vira a mesma resposta 413 da rota
                    raise AppError(413, ErrorCode.ATTACHMENT_TOO_LARGE, _limit_message())
            return message

        await self.app(scope, limited_receive, send)

    async def _refuse(self, send: Send) -> None:
        body = json.dumps({"detail": _limit_message(), "code": ErrorCode.ATTACHMENT_TOO_LARGE.value}).encode()
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

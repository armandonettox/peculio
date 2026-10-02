import logging
import uuid
from collections.abc import Iterable
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger("finance-app")


def user_dir(user_id: uuid.UUID) -> Path:
    return Path(settings.attachments_dir) / str(user_id)


def storage_path(user_id: uuid.UUID, storage_name: str) -> Path:
    """Caminho do arquivo em disco. So entram o id do usuario e um nome gerado pelo servidor:
    o nome que veio do cliente nunca chega aqui."""
    return user_dir(user_id) / storage_name


def remove_files(paths: Iterable[Path]) -> None:
    """Apaga os arquivos depois do commit. Uma falha vai para o log e nao derruba a requisicao:
    o registro no banco ja sumiu, entao o pior caso e um arquivo sobrando em disco."""
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.exception("Nao foi possivel apagar o anexo %s", path.name)

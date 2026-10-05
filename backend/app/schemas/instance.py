from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, EmailStr, Field, TypeAdapter, ValidationError, field_validator

MAX_CONTACT_LENGTH = 200
_email = TypeAdapter(EmailStr)


def normalize_contact(value: str) -> str:
    """Um e-mail (vira minusculo) ou um endereco https:// de formulario. Qualquer outra coisa e recusada:
    o contato vai para o security.txt, que robos e pesquisadores leem, entao nada de mailto: nem javascript:."""
    value = value.strip()
    if not value:
        raise ValueError("Informe um e-mail ou um endereco https://")
    if value.lower().startswith("https://"):
        parsed = urlparse(value)
        if not parsed.netloc or parsed.username or parsed.password or any(c in value for c in " \r\n\t"):
            raise ValueError("O endereco https:// nao e valido")
        return value
    try:
        return str(_email.validate_python(value)).lower()
    except ValidationError:
        raise ValueError("Informe um e-mail valido ou um endereco que comece com https://") from None


class SecurityContactIn(BaseModel):
    # Vazio ou nulo apaga o contato
    contact: str | None = Field(default=None, max_length=MAX_CONTACT_LENGTH)

    @field_validator("contact")
    @classmethod
    def _check(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        return normalize_contact(value)


class SecurityContactOut(BaseModel):
    contact: str | None
    updated_at: datetime | None

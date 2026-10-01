import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def validate_password(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Senha deve ter pelo menos 8 caracteres")
    # O bcrypt ignora tudo depois de 72 bytes, entao senha maior que isso seria enganosa
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Senha muito longa (maximo 72 bytes)")
    return value


def normalize_email(value: str) -> str:
    return value.strip().lower()


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str
    # Obrigatorio depois que o primeiro usuario existe
    invite_token: str | None = None

    _normalize_email = field_validator("email")(normalize_email)
    _validate_password = field_validator("password")(validate_password)


class UserLogin(BaseModel):
    email: EmailStr
    password: str

    _normalize_email = field_validator("email")(normalize_email)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: EmailStr
    is_admin: bool
    default_currency: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginOut(BaseModel):
    """Resposta do passo 1. Sem 2FA vem o token de acesso; com 2FA vem so o desafio."""

    access_token: str | None = None
    token_type: str = "bearer"
    two_factor_required: bool = False
    challenge_token: str | None = None


class TwoFactorVerify(BaseModel):
    challenge_token: str
    # Codigo de 6 digitos do app autenticador ou codigo de recuperacao
    code: str = Field(min_length=1, max_length=32)


class TwoFactorSetupOut(BaseModel):
    secret: str
    otpauth_url: str


class TwoFactorCode(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class TwoFactorConfirm(BaseModel):
    """Para desligar o 2FA ou gerar novos codigos: senha e um codigo valido."""

    password: str
    code: str = Field(min_length=1, max_length=32)


class RecoveryCodesOut(BaseModel):
    # Aparecem so nesta resposta. No banco fica apenas o hash.
    recovery_codes: list[str]


class TwoFactorStatus(BaseModel):
    enabled: bool
    recovery_codes_remaining: int


class AuthStatus(BaseModel):
    # So um booleano: nao revela quantos usuarios existem nem quem sao
    setup_required: bool


class InviteCreate(BaseModel):
    email: EmailStr

    _normalize_email = field_validator("email")(normalize_email)


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    expires_at: datetime
    used_at: datetime | None
    created_at: datetime


class InviteCreated(InviteOut):
    # O token so aparece nesta resposta. No banco fica apenas o hash dele.
    token: str

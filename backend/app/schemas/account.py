import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.account import ASSET_ROLES, LIABILITY_ROLES, AccountRole, AccountType

# Dinheiro: ate 18 digitos e 2 casas. No JSON sai como texto ("1234.50"), nunca como float.
Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]

# Tipos que o usuario cria pelas telas de contas
UserAccountType = Literal[AccountType.asset, AccountType.liability]


class CurrencyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    symbol: str
    decimal_places: int


def roles_for(account_type: AccountType) -> set[AccountRole]:
    return ASSET_ROLES if account_type == AccountType.asset else LIABILITY_ROLES


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: UserAccountType
    role: AccountRole | None = None
    currency_code: str = Field(min_length=3, max_length=3)
    # Conta de ativo: saldo no dia (pode ser negativo). Passivo: quanto voce deve (nunca negativo).
    opening_balance: Money = Decimal("0")
    opening_balance_date: date | None = None
    iban: str | None = Field(default=None, max_length=34)
    account_number: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=2000)
    # O dinheiro desta conta entra no "A orcar" dos envelopes
    in_envelopes: bool = True

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Informe o nome da conta")
        return value

    @field_validator("currency_code")
    @classmethod
    def upper_currency(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def check_role_and_opening(self):
        if self.role is not None and self.role not in roles_for(self.type):
            raise ValueError("Tipo de conta incompativel com o papel informado")
        if self.type == AccountType.liability and self.opening_balance < 0:
            raise ValueError("O valor devido nao pode ser negativo")
        return self


class AccountUpdate(BaseModel):
    # Moeda e tipo nao mudam depois de criada: o saldo e o historico dependem deles
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    role: AccountRole | None = None
    active: bool | None = None
    in_envelopes: bool | None = None
    iban: str | None = Field(default=None, max_length=34)
    account_number: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=2000)
    opening_balance: Money | None = None
    opening_balance_date: date | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Informe o nome da conta")
        return value


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type: AccountType
    role: AccountRole | None
    currency_code: str
    active: bool
    in_envelopes: bool
    iban: str | None
    account_number: str | None
    notes: str | None
    # Mesmo sentido da entrada: saldo no dia (ativo) ou valor devido (passivo)
    opening_balance: Money
    opening_balance_date: date | None
    # Saldo atual com sinal: negativo em passivo significa divida
    balance: Money
    created_at: datetime

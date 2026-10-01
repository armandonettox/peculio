import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.account import AccountType
from app.models.transaction import TransactionType

# Dinheiro: ate 18 digitos e 2 casas. No JSON sai como texto ("1234.50"), nunca como float.
Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]
# Valor de um lancamento: sempre positivo. O sentido do dinheiro esta em origem e destino, e o
# banco recusa zero ou negativo; sem esta checagem isso viraria erro 500 em vez de 422.
PositiveMoney = Annotated[Decimal, Field(max_digits=18, decimal_places=2, gt=0)]

# Tipos que o usuario cria pelas telas de transacoes (saldo inicial e conciliacao sao do sistema)
UserTransactionType = Literal[TransactionType.withdrawal, TransactionType.deposit, TransactionType.transfer]


class TransactionSplitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: UserTransactionType
    date: date
    description: str = Field(min_length=1, max_length=255)
    amount: PositiveMoney
    currency_code: str = Field(min_length=3, max_length=3)
    foreign_amount: PositiveMoney | None = None
    foreign_currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    category_id: uuid.UUID | None = None
    # Orcamento: so em saida para uma despesa, na moeda do orcamento (validado no servico)
    budget_id: uuid.UUID | None = None
    tag_ids: list[uuid.UUID] = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=2000)

    # Conta do usuario (origem no saque, destino no deposito, qualquer lado na transferencia)
    account_id: uuid.UUID
    # Contraparte: conta existente (despesa/receita/outra conta do usuario) ou nome novo
    counterparty_account_id: uuid.UUID | None = None
    counterparty_name: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Informe a descricao")
        return value

    @field_validator("currency_code", "foreign_currency_code")
    @classmethod
    def upper_currency(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else value

    @field_validator("counterparty_name")
    @classmethod
    def strip_counterparty_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("Informe o nome da contraparte")
        return value

    @model_validator(mode="after")
    def check_foreign_and_counterparty(self):
        if (self.foreign_amount is None) != (self.foreign_currency_code is None):
            raise ValueError("Valor e moeda estrangeira devem vir juntos")
        if self.type == "transfer":
            if self.counterparty_name is not None:
                raise ValueError("Transferencia precisa de uma conta existente, nao de um nome novo")
            if self.counterparty_account_id is None:
                raise ValueError("Informe a conta de destino da transferencia")
        else:
            if self.counterparty_account_id is not None and self.counterparty_name is not None:
                raise ValueError("Informe so a conta existente ou so o nome da contraparte, nao os dois")
            if self.counterparty_account_id is None and self.counterparty_name is None:
                raise ValueError("Informe a contraparte: uma conta existente ou um nome novo")
        return self


class TransactionSplitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: TransactionType
    date: date
    description: str
    source_account_id: uuid.UUID
    destination_account_id: uuid.UUID
    # Nome e tipo das duas pontas: a tela mostra "Supermercado" sem precisar buscar a conta
    # de despesa ou receita, que a lista de contas esconde
    source_account_name: str
    source_account_type: AccountType
    destination_account_name: str
    destination_account_type: AccountType
    amount: Money
    currency_code: str
    foreign_amount: Money | None
    foreign_currency_code: str | None
    category_id: uuid.UUID | None
    budget_id: uuid.UUID | None
    tag_ids: list[uuid.UUID]
    notes: str | None


class TransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=255)
    splits: list[TransactionSplitCreate] = Field(min_length=1)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        return value or None


class TransactionUpdate(TransactionCreate):
    """Mesma forma da criacao: a edicao troca o grupo inteiro (titulo e splits)."""


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None
    created_at: datetime
    splits: list[TransactionSplitOut]


class CounterpartyOut(BaseModel):
    """Contraparte ja usada (conta de despesa ou receita), para sugerir ao digitar."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str

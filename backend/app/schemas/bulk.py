import datetime as dt
import uuid
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Quantos lancamentos uma acao em massa aceita de uma vez. A tela so seleciona o que esta carregado; o teto protege o
# servidor de um pedido enorme (cada lancamento mexe em varias tabelas e dispara webhooks).
BULK_MAX_IDS = 200


class BulkAction(StrEnum):
    set_category = "set_category"
    set_date = "set_date"
    duplicate = "duplicate"
    delete = "delete"


class BulkIn(BaseModel):
    """Uma acao aplicada a varios lancamentos de uma vez, tudo ou nada."""

    model_config = ConfigDict(extra="forbid")

    ids: list[uuid.UUID] = Field(min_length=1, max_length=BULK_MAX_IDS)
    action: BulkAction
    # set_category: a categoria nova; sem ela (null), a categoria dos lancamentos e limpa
    category_id: uuid.UUID | None = None
    # set_date: a data nova de todas as divisoes
    date: dt.date | None = None

    @model_validator(mode="after")
    def check_action_fields(self):
        if len(set(self.ids)) != len(self.ids):
            raise ValueError("Ha lancamentos repetidos na lista")
        if self.action == BulkAction.set_date and self.date is None:
            raise ValueError("Informe a data nova")
        if self.action != BulkAction.set_date and self.date is not None:
            raise ValueError("A data so vale para a acao de mudar a data")
        if self.action != BulkAction.set_category and self.category_id is not None:
            raise ValueError("A categoria so vale para a acao de mudar a categoria")
        return self


class BulkOut(BaseModel):
    # Quantos lancamentos a acao atingiu
    affected: int
    # Duplicar: os lancamentos novos, na ordem em que foram pedidos. Nas outras acoes, vazio.
    created_ids: list[uuid.UUID]

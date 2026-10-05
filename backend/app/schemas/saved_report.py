import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.saved_report import ReportChart, ReportGroupBy, ReportMeasure, ReportPeriod

# Quantos relatorios salvos cada pessoa pode ter
MAX_SAVED_REPORTS = 30


def config_error(group_by: ReportGroupBy, chart: ReportChart, measure: ReportMeasure) -> str | None:
    """Por que essa combinacao nao faz sentido (ou None se serve). Valem as mesmas regras na tela."""
    # A linha liga pontos no tempo: so o agrupamento por mes tem uma ordem
    if chart == ReportChart.line and group_by != ReportGroupBy.month:
        return "O grafico de linha so serve para agrupar por mes"
    if chart == ReportChart.donut:
        # A rosca mostra fatias de um todo: meses nao sao partes de um todo e o saldo pode ser negativo
        if group_by == ReportGroupBy.month:
            return "O grafico de rosca nao serve para agrupar por mes"
        if measure == ReportMeasure.net:
            return "O grafico de rosca nao serve para o saldo, que pode ser negativo"
    return None


class SavedReportIn(BaseModel):
    """O que a pessoa montou: tudo que a tela precisa para abrir o relatorio de novo."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    group_by: ReportGroupBy
    chart: ReportChart
    measure: ReportMeasure
    period: ReportPeriod
    # So no periodo "fixed"; nos prontos o periodo se atualiza sozinho
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    tag_id: uuid.UUID | None = None
    budget_id: uuid.UUID | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Informe o nome")
        return value

    @model_validator(mode="after")
    def check_config(self):
        if self.period == ReportPeriod.fixed:
            if self.date_from is None or self.date_to is None:
                raise ValueError("Informe as duas datas do periodo fixo")
            if self.date_from > self.date_to:
                raise ValueError("A data inicial nao pode ser depois da data final")
        elif self.date_from is not None or self.date_to is not None:
            raise ValueError("As datas so valem no periodo fixo")
        error = config_error(self.group_by, self.chart, self.measure)
        if error:
            raise ValueError(error)
        return self


class SavedReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    group_by: ReportGroupBy
    chart: ReportChart
    measure: ReportMeasure
    period: ReportPeriod
    date_from: dt.date | None
    date_to: dt.date | None
    account_id: uuid.UUID | None
    category_id: uuid.UUID | None
    tag_id: uuid.UUID | None
    budget_id: uuid.UUID | None
    created_at: dt.datetime
    updated_at: dt.datetime

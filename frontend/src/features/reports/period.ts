import type { ReportFilters } from "@/api/reports";

// Os filtros ficam na URL (/relatorios?periodo=ano&conta=...), como na tela de transacoes:
// o link copiado e o botao Voltar abrem o mesmo relatorio.
export type PeriodKind = "this-month" | "last-month" | "this-year" | "custom";

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  "this-month": "Este mês",
  "last-month": "Mês passado",
  "this-year": "Este ano",
  custom: "Personalizado",
};

export const PERIOD_KINDS: PeriodKind[] = ["this-month", "last-month", "this-year", "custom"];

const PERIOD_PARAM: Record<PeriodKind, string | null> = {
  "this-month": null,
  "last-month": "mes-passado",
  "this-year": "ano",
  custom: "personalizado",
};

// O periodo tem parametro proprio (`periodo`); as demais chaves do filtro vao uma a uma para a URL
type FilterKey = Exclude<keyof ReportFilters, "period">;

const PARAM = {
  dateFrom: "de",
  dateTo: "ate",
  accountId: "conta",
  categoryId: "categoria",
  tagId: "tag",
  budgetId: "orcamento",
} as const satisfies Record<FilterKey, string>;

const FILTER_FIELDS = ["accountId", "categoryId", "tagId", "budgetId"] as const;

export type ReportState = Omit<ReportFilters, "period"> & { period: PeriodKind };

export function readState(params: URLSearchParams): ReportState {
  const raw = params.get("periodo");
  const period = PERIOD_KINDS.find((kind) => PERIOD_PARAM[kind] === raw) ?? "this-month";
  const state: ReportState = { period };
  for (const field of Object.keys(PARAM) as FilterKey[]) {
    const value = params.get(PARAM[field]);
    if (value) state[field] = value;
  }
  return state;
}

/** Aplica mudancas; valor vazio remove da URL. As datas soltas so valem no periodo personalizado. */
export function writeState(params: URLSearchParams, patch: Partial<ReportState>): URLSearchParams {
  const next = new URLSearchParams(params);
  if ("period" in patch) {
    const value = PERIOD_PARAM[patch.period ?? "this-month"];
    if (value) next.set("periodo", value);
    else next.delete("periodo");
    if (patch.period !== "custom") {
      next.delete(PARAM.dateFrom);
      next.delete(PARAM.dateTo);
    }
  }
  for (const field of Object.keys(PARAM) as FilterKey[]) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value) next.set(PARAM[field], value);
    else next.delete(PARAM[field]);
  }
  return next;
}

/** Filtros ativos alem do periodo (conta, categoria, tag, orcamento). */
export function countActiveFilters(state: ReportState): number {
  return FILTER_FIELDS.filter((field) => Boolean(state[field])).length;
}

/**
 * Filtros enviados a API. Periodo pronto vai como `period` e o servidor resolve as datas pelo
 * relogio do app; so o personalizado manda datas.
 */
export function toReportFilters(state: ReportState): ReportFilters {
  const filters: ReportFilters = {};
  if (state.period === "custom") {
    if (state.dateFrom) filters.dateFrom = state.dateFrom;
    if (state.dateTo) filters.dateTo = state.dateTo;
  } else {
    filters.period = state.period;
  }
  for (const field of FILTER_FIELDS) {
    const value = state[field];
    if (value) filters[field] = value;
  }
  return filters;
}

/** A data inicial nao pode ser depois da final (texto AAAA-MM-DD compara certo como string). */
export function dateRangeError(filters: ReportFilters): string | undefined {
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return "A data inicial é depois da data final.";
  }
  return undefined;
}

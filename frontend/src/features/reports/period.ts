import type { ReportFilters } from "@/api/reports";
import { shiftDay, shiftMonth, firstOfMonth } from "@/lib/dates";

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

const PARAM = {
  dateFrom: "de",
  dateTo: "ate",
  accountId: "conta",
  categoryId: "categoria",
  tagId: "tag",
  budgetId: "orcamento",
} as const satisfies Record<keyof ReportFilters, string>;

const FILTER_FIELDS = ["accountId", "categoryId", "tagId", "budgetId"] as const;

export type ReportState = ReportFilters & { period: PeriodKind };

export function readState(params: URLSearchParams): ReportState {
  const raw = params.get("periodo");
  const period = PERIOD_KINDS.find((kind) => PERIOD_PARAM[kind] === raw) ?? "this-month";
  const state: ReportState = { period };
  for (const field of Object.keys(PARAM) as (keyof ReportFilters)[]) {
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
  for (const field of Object.keys(PARAM) as (keyof ReportFilters)[]) {
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

function lastOfMonth(date: string): string {
  return shiftDay(shiftMonth(date, 1), -1);
}

/** Datas do periodo escolhido, calculadas a partir de `today` (AAAA-MM-DD). */
export function resolvePeriod(state: ReportState, today: string): { dateFrom?: string; dateTo?: string } {
  const thisMonth = firstOfMonth(today);
  switch (state.period) {
    case "this-month":
      return { dateFrom: thisMonth, dateTo: lastOfMonth(thisMonth) };
    case "last-month": {
      const first = shiftMonth(thisMonth, -1);
      return { dateFrom: first, dateTo: lastOfMonth(first) };
    }
    case "this-year": {
      const year = today.slice(0, 4);
      return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
    }
    case "custom":
      return { dateFrom: state.dateFrom, dateTo: state.dateTo };
  }
}

export function toReportFilters(state: ReportState, today: string): ReportFilters {
  const { dateFrom, dateTo } = resolvePeriod(state, today);
  const filters: ReportFilters = {};
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;
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

import { useQuery } from "@tanstack/react-query";

import { tokenStore } from "@/auth/token-store";
import { currentLanguage } from "@/i18n";
import { api, unwrap } from "./client";
import { ApiError } from "./errors";
import { reportsKey } from "./query-keys";
import type { components } from "./schema";

export type ReportTotals = components["schemas"]["ReportTotals"];
export type ReportRow = components["schemas"]["ReportRow"];
export type ReportGroupBlock = components["schemas"]["ReportGroupBlock"];
export type MonthlyBlock = components["schemas"]["MonthlyBlock"];
export type MonthlyPoint = components["schemas"]["MonthlyPoint"];

export { reportsKey };

// Periodos prontos: o servidor resolve pelo relogio do app, nunca pelo do navegador
export type ReportPeriod = "this-month" | "last-month" | "this-year" | "last-3-months" | "last-12-months";

export type ReportFilters = {
  period?: ReportPeriod;
  // AAAA-MM-DD, so no periodo personalizado
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  categoryId?: string;
  tagId?: string;
  budgetId?: string;
};

export type GroupedDimension = "category" | "tag" | "budget" | "account" | "counterparty";

function toQuery(filters: ReportFilters) {
  return {
    ...(filters.period ? { period: filters.period } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    ...(filters.accountId ? { account_id: filters.accountId } : {}),
    ...(filters.categoryId ? { category_id: filters.categoryId } : {}),
    ...(filters.tagId ? { tag_id: filters.tagId } : {}),
    ...(filters.budgetId ? { budget_id: filters.budgetId } : {}),
  };
}

type Options = { enabled?: boolean };

export function useReportSummary(filters: ReportFilters, { enabled = true }: Options = {}) {
  return useQuery({
    queryKey: [...reportsKey, "summary", filters],
    enabled,
    queryFn: () => unwrap(api.client.GET("/api/v1/reports/summary", { params: { query: toQuery(filters) } })),
  });
}

export function useReportMonthly(filters: ReportFilters, { enabled = true }: Options = {}) {
  return useQuery({
    queryKey: [...reportsKey, "monthly", filters],
    enabled,
    queryFn: () => unwrap(api.client.GET("/api/v1/reports/monthly", { params: { query: toQuery(filters) } })),
  });
}

export function useReportGrouped(
  dimension: GroupedDimension,
  filters: ReportFilters,
  { enabled = true }: Options = {},
) {
  const query = { params: { query: toQuery(filters) } };
  return useQuery({
    queryKey: [...reportsKey, dimension, filters],
    enabled,
    queryFn: () => {
      switch (dimension) {
        case "category":
          return unwrap(api.client.GET("/api/v1/reports/by-category", query));
        case "tag":
          return unwrap(api.client.GET("/api/v1/reports/by-tag", query));
        case "budget":
          return unwrap(api.client.GET("/api/v1/reports/by-budget", query));
        case "account":
          return unwrap(api.client.GET("/api/v1/reports/by-account", query));
        case "counterparty":
          return unwrap(api.client.GET("/api/v1/reports/by-counterparty", query));
      }
    },
  });
}

// ---------- Exportacao em CSV ----------

export type CsvFile = { blob: Blob; filename: string };

// O CSV pede datas explicitas (a exportacao e de lancamentos, nao conhece periodos prontos)
export type CsvFilters = Omit<ReportFilters, "period">;

function csvQuery(filters: CsvFilters): string {
  const params = new URLSearchParams(toQuery(filters));
  const text = params.toString();
  return text ? `?${text}` : "";
}

// attachment; filename="lancamentos-2026-03-09.csv"
function filenameFrom(response: Response): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1] : "lancamentos.csv";
}

/**
 * Baixa o CSV de lancamentos com os mesmos filtros do relatorio. O token vai no cabecalho
 * Authorization, nunca na URL (URL aparece em historico e logs). Num 401, renova a sessao uma vez.
 */
export async function downloadTransactionsCsv(filters: CsvFilters): Promise<CsvFile> {
  const url = `${window.location.origin}/api/v1/transactions/export.csv${csvQuery(filters)}`;

  async function attempt(): Promise<Response> {
    const token = tokenStore.get();
    return fetch(url, {
      headers: { "Accept-Language": currentLanguage(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  }

  let response: Response;
  try {
    response = await attempt();
    if (response.status === 401 && tokenStore.get() && (await api.refreshAccessToken())) {
      response = await attempt();
    }
  } catch {
    throw ApiError.network();
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw ApiError.fromResponse(response.status, body);
  }
  return { blob: await response.blob(), filename: filenameFrom(response) };
}

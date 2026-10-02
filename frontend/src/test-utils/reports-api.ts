import { http, HttpResponse } from "msw";

import type { MonthlyBlock, ReportGroupBlock, ReportRow, ReportTotals } from "@/api/reports";

let counter = 0;

export function makeRow(overrides: Partial<ReportRow> = {}): ReportRow {
  counter += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Linha ${counter}`,
    income: "0.00",
    expense: "0.00",
    net: "0.00",
    count: 1,
    ...overrides,
  };
}

export function makeTotals(overrides: Partial<ReportTotals> = {}): ReportTotals {
  return { currency_code: "BRL", income: "5000.00", expense: "686.40", net: "4313.60", count: 7, ...overrides };
}

export function makeGroup(rows: ReportRow[], totals: Partial<ReportTotals> = {}): ReportGroupBlock {
  return { ...makeTotals(totals), rows };
}

export function makeMonthly(currencyCode: string, months: MonthlyBlock["months"]): MonthlyBlock {
  return { currency_code: currencyCode, months };
}

type NextError = { status: number; code: string; errors?: { field: string; message: string }[] };
type Recorded = { path: string; query: URLSearchParams; headers: Headers };

export type ReportData = {
  summary: ReportTotals[];
  monthly: MonthlyBlock[];
  category: ReportGroupBlock[];
  tag: ReportGroupBlock[];
  budget: ReportGroupBlock[];
  account: ReportGroupBlock[];
};

const pad = (value: number) => String(value).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Os periodos prontos, como o servidor os resolve a partir do seu dia. */
function presetDates(period: string | null, today: string): { from: string; to: string } | null {
  const [year, month] = today.split("-").map(Number);
  const monthRange = (y: number, m: number) => ({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
  if (period === "this-month") return monthRange(year, month);
  if (period === "last-month") return month === 1 ? monthRange(year - 1, 12) : monthRange(year, month - 1);
  if (period === "this-year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  return null;
}

/**
 * API de relatorios de mentira. Devolve os dados que o teste escolheu, sem recalcular nada (as
 * somas sao testadas no backend), e guarda cada pedido para o teste conferir filtros e cabecalhos.
 */
export function fakeReportsApi(initial: Partial<ReportData> = {}) {
  const state = {
    data: { summary: [], monthly: [], category: [], tag: [], budget: [], account: [], ...initial } as ReportData,
    requests: [] as Recorded[],
    // Erro devolvido nos proximos pedidos de relatorio (um por chamada), ate zerar
    errors: [] as NextError[],
    csvError: null as NextError | null,
    csvBody: "﻿data;tipo\r\n",
    csvFilename: "lancamentos-2026-03-15.csv",
    // O dia do relogio do app (servidor), independente do relogio do navegador do teste
    serverToday: "2026-03-15",
  };

  const fail = (error: NextError) =>
    HttpResponse.json(
      { detail: "erro", code: error.code, ...(error.errors ? { errors: error.errors } : {}) },
      { status: error.status },
    );

  function report(path: keyof ReportData, route: string) {
    return http.get(`*/api/v1/reports/${route}`, ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ path: route, query, headers: request.headers });
      const error = state.errors.shift();
      if (error) return fail(error);
      const preset = presetDates(query.get("period"), state.serverToday);
      return HttpResponse.json({
        date_from: preset?.from ?? query.get("date_from") ?? "2026-03-01",
        date_to: preset?.to ?? query.get("date_to") ?? "2026-03-31",
        currencies: state.data[path],
      });
    });
  }

  const handlers = [
    report("summary", "summary"),
    report("monthly", "monthly"),
    report("category", "by-category"),
    report("tag", "by-tag"),
    report("budget", "by-budget"),
    report("account", "by-account"),

    http.get("*/api/v1/transactions/export.csv", ({ request }) => {
      const url = new URL(request.url);
      state.requests.push({ path: "export.csv", query: url.searchParams, headers: request.headers });
      if (state.csvError) return fail(state.csvError);
      return new HttpResponse(state.csvBody, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${state.csvFilename}"`,
        },
      });
    }),
  ];

  const requestsTo = (route: string) => state.requests.filter((request) => request.path === route);
  return { handlers, state, requestsTo };
}

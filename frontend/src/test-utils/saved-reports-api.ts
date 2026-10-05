import { http, HttpResponse } from "msw";

import type { SavedReport, SavedReportBody } from "@/api/saved-reports";

let counter = 0;

export function makeSaved(overrides: Partial<SavedReport> = {}): SavedReport {
  counter += 1;
  return {
    id: `70000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Relatorio ${counter}`,
    group_by: "category",
    chart: "donut",
    measure: "expense",
    period: "this-month",
    date_from: null,
    date_to: null,
    account_id: null,
    category_id: null,
    tag_id: null,
    budget_id: null,
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

type NextError = { status: number; code: string };
type Recorded = { method: string; id?: string; body?: SavedReportBody };

// Mesmo teto do servidor
const LIMIT = 30;

/**
 * API de relatorios salvos de mentira, com estado: criar, editar e excluir mudam a lista que o proximo GET devolve,
 * e o nome precisa ser unico sem diferenciar maiusculas, como no servidor.
 */
export function fakeSavedReportsApi(initial: SavedReport[] = []) {
  const state = {
    reports: [...initial],
    requests: [] as Recorded[],
    nextError: null as NextError | null,
    listError: false,
  };

  const fail = (status: number, code: string) => HttpResponse.json({ detail: "erro", code }, { status });
  const takeError = () => {
    const error = state.nextError;
    state.nextError = null;
    return error ? fail(error.status, error.code) : null;
  };
  const taken = (name: string, ownId?: string) =>
    state.reports.some((report) => report.id !== ownId && report.name.toLowerCase() === name.toLowerCase());
  const sorted = () => [...state.reports].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const handlers = [
    http.get("*/api/v1/reports/saved", () => {
      state.requests.push({ method: "GET" });
      if (state.listError) return fail(500, "internal_error");
      return HttpResponse.json(sorted());
    }),

    http.post("*/api/v1/reports/saved", async ({ request }) => {
      const body = (await request.json()) as SavedReportBody;
      state.requests.push({ method: "POST", body });
      const error = takeError();
      if (error) return error;
      if (state.reports.length >= LIMIT) return fail(409, "saved_report_limit_reached");
      if (taken(body.name)) return fail(409, "saved_report_name_taken");
      const created = makeSaved({
        name: body.name,
        group_by: body.group_by,
        chart: body.chart,
        measure: body.measure,
        period: body.period,
        date_from: body.date_from ?? null,
        date_to: body.date_to ?? null,
        account_id: body.account_id ?? null,
        category_id: body.category_id ?? null,
        tag_id: body.tag_id ?? null,
        budget_id: body.budget_id ?? null,
      });
      state.reports.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.put("*/api/v1/reports/saved/:id", async ({ request, params }) => {
      const body = (await request.json()) as SavedReportBody;
      state.requests.push({ method: "PUT", id: String(params.id), body });
      const error = takeError();
      if (error) return error;
      const index = state.reports.findIndex((report) => report.id === params.id);
      if (index === -1) return fail(404, "saved_report_not_found");
      if (taken(body.name, String(params.id))) return fail(409, "saved_report_name_taken");
      const updated: SavedReport = {
        ...state.reports[index],
        name: body.name,
        group_by: body.group_by,
        chart: body.chart,
        measure: body.measure,
        period: body.period,
        date_from: body.date_from ?? null,
        date_to: body.date_to ?? null,
        account_id: body.account_id ?? null,
        category_id: body.category_id ?? null,
        tag_id: body.tag_id ?? null,
        budget_id: body.budget_id ?? null,
      };
      state.reports[index] = updated;
      return HttpResponse.json(updated);
    }),

    http.delete("*/api/v1/reports/saved/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", id: String(params.id) });
      const error = takeError();
      if (error) return error;
      if (!state.reports.some((report) => report.id === params.id)) return fail(404, "saved_report_not_found");
      state.reports = state.reports.filter((report) => report.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const writes = () => state.requests.filter((request) => request.method !== "GET");
  return { handlers, state, writes };
}

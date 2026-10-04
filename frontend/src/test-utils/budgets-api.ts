import { http, HttpResponse } from "msw";

import type { BudgetProgress } from "@/api/budgets";

let counter = 0;

/** Orcamento com progresso. `remaining` e `percent` saem de `amount` e `spent`, como no backend. */
export function makeBudget(overrides: Partial<BudgetProgress> = {}): BudgetProgress {
  counter += 1;
  const base: BudgetProgress = {
    id: `b0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Orcamento ${counter}`,
    currency_code: "BRL",
    mode: "fixed",
    amount: "800.00",
    period: "monthly",
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    period_start: "2026-03-01",
    period_end: "2026-03-31",
    spent: "0.00",
    remaining: "800.00",
    percent: 0,
    ...overrides,
  };
  const amount = Number(base.amount);
  const spent = Number(base.spent);
  return {
    ...base,
    remaining: overrides.remaining ?? (amount - spent).toFixed(2),
    percent: overrides.percent ?? Math.floor((spent * 100) / amount),
  };
}

type NextError = { status: number; code: string; errors?: { field: string; message: string }[] };
type Recorded = { method: string; path: string; body?: Record<string, unknown>; query?: URLSearchParams };

/**
 * API de orcamentos de mentira, com estado. Recusa nome repetido sem diferenciar maiuscula de
 * minuscula e esconde arquivados do progresso, como o backend.
 */
export function fakeBudgetsApi(initial: BudgetProgress[] = []) {
  const state = {
    budgets: [...initial],
    requests: [] as Recorded[],
    nextMutationError: null as NextError | null,
    listError: false,
  };

  const fail = (error: NextError) =>
    HttpResponse.json(
      { detail: "erro", code: error.code, ...(error.errors ? { errors: error.errors } : {}) },
      { status: error.status },
    );
  const takeError = () => {
    const error = state.nextMutationError;
    state.nextMutationError = null;
    return error;
  };
  const taken = (name: string, ignoreId?: string) =>
    state.budgets.some((item) => item.id !== ignoreId && item.name.toLowerCase() === name.trim().toLowerCase());
  const sorted = (items: BudgetProgress[]) =>
    [...items].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const handlers = [
    http.get("*/api/v1/budgets/progress", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/budgets/progress", query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const archived = query.get("include_archived") === "true";
      return HttpResponse.json(sorted(state.budgets.filter((item) => archived || item.active)));
    }),

    http.get("*/api/v1/budgets", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/budgets", query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const onlyActive = query.get("active") === "true";
      const items = sorted(state.budgets.filter((item) => !onlyActive || item.active));
      return HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 });
    }),

    http.post("*/api/v1/budgets", async ({ request }) => {
      const body = (await request.json()) as Record<string, string>;
      state.requests.push({ method: "POST", path: "/budgets", body });
      const error = takeError();
      if (error) return fail(error);
      if (taken(body.name)) return fail({ status: 409, code: "budget_name_taken" });
      const created = makeBudget({
        name: body.name,
        currency_code: body.currency_code,
        amount: body.amount,
        period: body.period as BudgetProgress["period"],
      });
      state.budgets.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.patch("*/api/v1/budgets/:id", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "PATCH", path: `/budgets/${params.id}`, body });
      const error = takeError();
      if (error) return fail(error);
      const index = state.budgets.findIndex((item) => item.id === params.id);
      if (index < 0) return fail({ status: 404, code: "budget_not_found" });
      if (typeof body.name === "string" && taken(body.name, String(params.id))) {
        return fail({ status: 409, code: "budget_name_taken" });
      }
      state.budgets[index] = makeBudget({ ...state.budgets[index], ...body, id: state.budgets[index].id });
      return HttpResponse.json(state.budgets[index]);
    }),

    http.delete("*/api/v1/budgets/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", path: `/budgets/${params.id}` });
      const error = takeError();
      if (error) return fail(error);
      state.budgets = state.budgets.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const mutations = () => state.requests.filter((request) => request.method !== "GET");
  const progressRequests = () => state.requests.filter((request) => request.path === "/budgets/progress");
  return { handlers, state, mutations, progressRequests };
}

import { http, HttpResponse } from "msw";

import type { BillStatus } from "@/api/bills";

let counter = 0;

/** Conta a pagar com a situacao ja calculada (o teste escolhe `status`, datas e `next_due_paid`). */
export function makeBill(overrides: Partial<BillStatus> = {}): BillStatus {
  counter += 1;
  return {
    id: `d0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Conta ${counter}`,
    currency_code: "BRL",
    amount_min: "40.00",
    amount_max: "60.00",
    match_text: "netflix",
    first_due_date: "2026-03-05",
    frequency: "monthly",
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    last_due_date: "2026-03-05",
    next_due_date: "2026-04-05",
    status: "overdue",
    overdue_count: 1,
    oldest_overdue_date: "2026-03-05",
    next_due_paid: false,
    ...overrides,
  };
}

type NextError = { status: number; code: string; errors?: { field: string; message: string }[] };
type Recorded = { method: string; path: string; body?: Record<string, unknown>; query?: URLSearchParams };

/**
 * API de contas a pagar de mentira, com estado. Recusa nome repetido sem diferenciar maiuscula de
 * minuscula e esconde arquivadas da situacao, como o backend. A situacao de cada conta e a que o teste
 * escreveu; a API falsa nao recalcula vencimentos (isso e testado no backend).
 */
export function fakeBillsApi(initial: BillStatus[] = []) {
  const state = {
    bills: [...initial],
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
    state.bills.some((item) => item.id !== ignoreId && item.name.toLowerCase() === name.trim().toLowerCase());
  // Ordem do backend: proximo vencimento, depois nome
  const sorted = (items: BillStatus[]) =>
    [...items].sort(
      (a, b) => a.next_due_date.localeCompare(b.next_due_date) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  const byName = (items: BillStatus[]) =>
    [...items].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const handlers = [
    http.get("*/api/v1/bills/status", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/bills/status", query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const archived = query.get("include_archived") === "true";
      return HttpResponse.json(sorted(state.bills.filter((item) => archived || item.active)));
    }),

    http.get("*/api/v1/bills", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/bills", query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const onlyActive = query.get("active") === "true";
      const items = byName(state.bills.filter((item) => !onlyActive || item.active));
      return HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 });
    }),

    http.post("*/api/v1/bills", async ({ request }) => {
      const body = (await request.json()) as Record<string, string | null>;
      state.requests.push({ method: "POST", path: "/bills", body });
      const error = takeError();
      if (error) return fail(error);
      if (taken(String(body.name))) return fail({ status: 409, code: "bill_name_taken" });
      const created = makeBill({
        name: String(body.name),
        currency_code: String(body.currency_code),
        amount_min: String(body.amount_min),
        amount_max: String(body.amount_max),
        match_text: body.match_text ?? null,
        first_due_date: String(body.first_due_date),
        frequency: body.frequency as BillStatus["frequency"],
        last_due_date: null,
        next_due_date: String(body.first_due_date),
        status: "upcoming",
      });
      state.bills.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.patch("*/api/v1/bills/:id", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "PATCH", path: `/bills/${params.id}`, body });
      const error = takeError();
      if (error) return fail(error);
      const index = state.bills.findIndex((item) => item.id === params.id);
      if (index < 0) return fail({ status: 404, code: "bill_not_found" });
      if (typeof body.name === "string" && taken(body.name, String(params.id))) {
        return fail({ status: 409, code: "bill_name_taken" });
      }
      state.bills[index] = { ...state.bills[index], ...body } as BillStatus;
      return HttpResponse.json(state.bills[index]);
    }),

    http.delete("*/api/v1/bills/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", path: `/bills/${params.id}` });
      const error = takeError();
      if (error) return fail(error);
      state.bills = state.bills.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const mutations = () => state.requests.filter((request) => request.method !== "GET");
  const statusRequests = () => state.requests.filter((request) => request.path === "/bills/status");
  return { handlers, state, mutations, statusRequests };
}

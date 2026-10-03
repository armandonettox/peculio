import { http, HttpResponse } from "msw";

import type { PiggyBank, PiggyBankEvent } from "@/api/piggy-banks";

let counter = 0;

/** Cofrinho com valores calculados a partir de `saved` e `target_amount`, como o backend faz. */
export function makePiggyBank(overrides: Partial<PiggyBank> = {}): PiggyBank {
  counter += 1;
  const base: PiggyBank = {
    id: `c0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Cofrinho ${counter}`,
    account_id: "a0000000-0000-4000-8000-000000000001",
    account_name: "Nubank",
    currency_code: "BRL",
    target_amount: "600.00",
    target_date: null,
    active: true,
    saved: "0.00",
    remaining: "600.00",
    percent: 0,
    suggested_per_month: null,
    account_available: "1000.00",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
  const target = Number(base.target_amount);
  const saved = Number(base.saved);
  return {
    ...base,
    remaining: overrides.remaining ?? Math.max(target - saved, 0).toFixed(2),
    percent: overrides.percent ?? Math.floor((saved * 100) / target),
  };
}

export function makeEvent(overrides: Partial<PiggyBankEvent> = {}): PiggyBankEvent {
  counter += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    kind: "add",
    amount: "100.00",
    date: "2026-03-10",
    note: null,
    created_at: "2026-03-10T12:00:00Z",
    ...overrides,
  };
}

type NextError = { status: number; code: string; errors?: { field: string; message: string }[] };
type Recorded = { method: string; path: string; body?: Record<string, unknown>; query?: URLSearchParams };

/**
 * API de cofrinhos de mentira, com estado. Guardar e retirar mexem no guardado e no disponivel (um so
 * valor, como se todos os cofrinhos fossem da mesma conta) e recusam o que passa do limite, como o backend.
 */
export function fakePiggyBanksApi(initial: PiggyBank[] = [], events: Record<string, PiggyBankEvent[]> = {}) {
  const state = {
    piggies: [...initial],
    events: { ...events },
    requests: [] as Recorded[],
    nextMutationError: null as NextError | null,
    listError: false,
    eventsError: false,
    eventsTotal: null as number | null,
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
    state.piggies.some((item) => item.id !== ignoreId && item.name.toLowerCase() === name.trim().toLowerCase());
  const sorted = () => [...state.piggies].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const handlers = [
    http.get("*/api/v1/piggy-banks", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/piggy-banks", query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      // Sem o filtro vem tudo; com active=true, so os que nao estao arquivados, como o backend
      const items = sorted().filter((item) => query.get("active") !== "true" || item.active);
      return HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 });
    }),

    http.get("*/api/v1/piggy-banks/:id/events", ({ request, params }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: `/piggy-banks/${params.id}/events`, query });
      if (state.eventsError) return fail({ status: 500, code: "internal_error" });
      const items = state.events[String(params.id)] ?? [];
      return HttpResponse.json({ items, total: state.eventsTotal ?? items.length, limit: 50, offset: 0 });
    }),

    http.post("*/api/v1/piggy-banks", async ({ request }) => {
      const body = (await request.json()) as Record<string, string | null>;
      state.requests.push({ method: "POST", path: "/piggy-banks", body });
      const error = takeError();
      if (error) return fail(error);
      if (taken(String(body.name))) return fail({ status: 409, code: "piggy_bank_name_taken" });
      const created = makePiggyBank({
        name: String(body.name),
        account_id: String(body.account_id),
        target_amount: String(body.target_amount),
        target_date: body.target_date ?? null,
      });
      state.piggies.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.patch("*/api/v1/piggy-banks/:id", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "PATCH", path: `/piggy-banks/${params.id}`, body });
      const error = takeError();
      if (error) return fail(error);
      const index = state.piggies.findIndex((item) => item.id === params.id);
      if (index < 0) return fail({ status: 404, code: "piggy_bank_not_found" });
      if (typeof body.name === "string" && taken(body.name, String(params.id))) {
        return fail({ status: 409, code: "piggy_bank_name_taken" });
      }
      state.piggies[index] = makePiggyBank({ ...state.piggies[index], ...body, id: state.piggies[index].id });
      return HttpResponse.json(state.piggies[index]);
    }),

    http.delete("*/api/v1/piggy-banks/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", path: `/piggy-banks/${params.id}` });
      const error = takeError();
      if (error) return fail(error);
      state.piggies = state.piggies.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),

    http.post("*/api/v1/piggy-banks/:id/events", async ({ request, params }) => {
      const body = (await request.json()) as { kind: "add" | "remove"; amount: string; date?: string; note?: string };
      state.requests.push({ method: "POST", path: `/piggy-banks/${params.id}/events`, body });
      const error = takeError();
      if (error) return fail(error);
      const index = state.piggies.findIndex((item) => item.id === params.id);
      if (index < 0) return fail({ status: 404, code: "piggy_bank_not_found" });
      const piggy = state.piggies[index];
      const amount = Number(body.amount);
      if (body.kind === "add" && amount > Number(piggy.account_available)) {
        return fail({ status: 400, code: "piggy_bank_not_enough_available" });
      }
      if (body.kind === "remove" && amount > Number(piggy.saved)) {
        return fail({ status: 400, code: "piggy_bank_not_enough_saved" });
      }
      const signed = body.kind === "add" ? amount : -amount;
      const available = (Number(piggy.account_available) - signed).toFixed(2);
      // Todos os cofrinhos da conta veem o mesmo disponivel
      state.piggies = state.piggies.map((item) =>
        item.account_id === piggy.account_id
          ? makePiggyBank({
              ...item,
              saved: item.id === piggy.id ? (Number(item.saved) + signed).toFixed(2) : item.saved,
              account_available: available,
              remaining: undefined,
              percent: undefined,
            })
          : item,
      );
      const key = String(params.id);
      state.events[key] = [makeEvent({ kind: body.kind, amount: body.amount, date: body.date ?? "2026-03-15", note: body.note ?? null }), ...(state.events[key] ?? [])];
      return HttpResponse.json(state.piggies.find((item) => item.id === piggy.id), { status: 201 });
    }),
  ];

  const mutations = () => state.requests.filter((request) => request.method !== "GET");
  return { handlers, state, mutations };
}

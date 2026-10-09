import { http, HttpResponse } from "msw";

import type { Account } from "@/api/accounts";

export const currencies = [
  { code: "BRL", name: "Real brasileiro", symbol: "R$", decimal_places: 2 },
  { code: "USD", name: "Dolar americano", symbol: "US$", decimal_places: 2 },
  { code: "JPY", name: "Iene japones", symbol: "JPY", decimal_places: 0 },
];

let counter = 0;

export function makeAccount(overrides: Partial<Account> = {}): Account {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Conta ${counter}`,
    type: "asset",
    role: "checking",
    currency_code: "BRL",
    active: true,
    in_envelopes: true,
    iban: null,
    account_number: null,
    notes: null,
    opening_balance: "0.00",
    opening_balance_date: null,
    balance: "0.00",
    closing_day: null,
    due_day: null,
    credit_limit: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

type NextError = { status: number; code: string; errors?: { field: string; message: string }[] };

type Recorded = { method: string; path: string; body?: Record<string, unknown>; query?: URLSearchParams };

/**
 * API de contas de mentira que guarda estado: criar, editar e excluir mudam a lista
 * que o proximo GET devolve, como o backend de verdade.
 */
export function fakeAccountsApi(initial: Account[] = []) {
  const state = {
    accounts: [...initial],
    requests: [] as Recorded[],
    // Erro devolvido na proxima chamada que muda dados (POST, PATCH ou DELETE)
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

  const handlers = [
    http.get("*/api/v1/currencies", () => HttpResponse.json(currencies)),

    http.get("*/api/v1/accounts", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/accounts", query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const onlyActive = query.get("active") === "true";
      const items = state.accounts.filter((account) => !onlyActive || account.active);
      return HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 });
    }),

    http.post("*/api/v1/accounts", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "POST", path: "/accounts", body });
      const error = takeError();
      if (error) return fail(error);
      const opening = String(body.opening_balance ?? "0");
      const signed = body.type === "liability" ? `-${opening}` : opening;
      const places = body.currency_code === "JPY" ? 0 : 2;
      const money = (value: string) => Number(value).toFixed(places);
      const created = makeAccount({
        name: String(body.name),
        type: body.type as Account["type"],
        role: body.role as Account["role"],
        currency_code: String(body.currency_code),
        notes: (body.notes as string | null) ?? null,
        opening_balance: money(opening),
        opening_balance_date: (body.opening_balance_date as string | undefined) ?? null,
        balance: money(signed),
        closing_day: (body.closing_day as number | undefined) ?? null,
        due_day: (body.due_day as number | undefined) ?? null,
        credit_limit: (body.credit_limit as string | undefined) ?? null,
      });
      state.accounts.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.patch("*/api/v1/accounts/:id", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "PATCH", path: `/accounts/${params.id}`, body });
      const error = takeError();
      if (error) return fail(error);
      const account = state.accounts.find((a) => a.id === params.id);
      if (!account) return fail({ status: 404, code: "account_not_found" });
      Object.assign(account, body);
      if (typeof body.opening_balance === "string") {
        account.opening_balance = body.opening_balance;
        account.balance = account.type === "liability" ? `-${body.opening_balance}` : body.opening_balance;
      }
      return HttpResponse.json(account);
    }),

    http.delete("*/api/v1/accounts/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", path: `/accounts/${params.id}` });
      const error = takeError();
      if (error) return fail(error);
      state.accounts = state.accounts.filter((a) => a.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const mutations = () => state.requests.filter((r) => r.method !== "GET");
  return { handlers, state, mutations };
}

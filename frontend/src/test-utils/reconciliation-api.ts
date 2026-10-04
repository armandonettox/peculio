import { http, HttpResponse } from "msw";

import type { ClosedReconciliation, ReconciliationRow, ReconciliationView } from "@/api/reconciliation";

const money = (value: number) => value.toFixed(2);

type Entry = { id: string; date: string; description: string; amount: number; cleared: boolean; locked: boolean };
type ClosedRecord = { id: string; statement_date: string; statement_balance: string; closed_at: string; invalidated_at: string | null; locked: string[] };
type NextError = { status: number; code: string; detail?: string };
type Recorded = { method: string; path: string; body?: unknown; query?: Record<string, string> };

let counter = 0;

/** Lancamento da conta (valor com sinal: positivo entrou, negativo saiu). */
export function makeEntry(description: string, amount: number, overrides: Partial<Entry> = {}): Entry {
  counter += 1;
  return {
    id: `50000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    date: "2026-03-10",
    description,
    amount,
    cleared: false,
    locked: false,
    ...overrides,
  };
}

/**
 * API de conciliacao de mentira, com estado, de uma conta so (BRL). Refaz a conta do backend: conferido = saldo inicial
 * + lancamentos marcados, diferenca = extrato - conferido; ajuste cria um lancamento ja conferido; fechar exige
 * diferenca zero e algo conferido, e trava; desfazer destrava e marca a conciliacao como desfeita.
 */
export function fakeReconciliationApi(entries: Entry[] = [], { opening = 1000, accountId = "a0000000-0000-4000-8000-000000000001" } = {}) {
  const state = {
    entries,
    opening,
    history: [] as ClosedRecord[],
    requests: [] as Recorded[],
    viewError: false,
    nextMutationError: null as NextError | null,
    // Segura a resposta de conferir ate o teste soltar: da para ver a tela enquanto o pedido esta no ar
    hold: null as Promise<void> | null,
  };

  const fail = (error: NextError) =>
    HttpResponse.json({ detail: error.detail ?? "erro", code: error.code }, { status: error.status });

  const takeError = () => {
    const error = state.nextMutationError;
    state.nextMutationError = null;
    return error;
  };

  const open = (upTo: string) => state.entries.filter((entry) => !entry.locked && entry.date <= upTo);
  const clearedBalance = (upTo: string) =>
    state.opening + state.entries.filter((entry) => entry.cleared && entry.date <= upTo).reduce((sum, entry) => sum + entry.amount, 0);

  function view(balance: number, date: string): ReconciliationView {
    const found = open(date).sort((a, b) => b.date.localeCompare(a.date));
    const cleared = clearedBalance(date);
    const difference = Math.round((balance - cleared) * 100) / 100;
    const rows: ReconciliationRow[] = found.map((entry) => ({
      split_id: entry.id,
      transaction_id: `t-${entry.id}`,
      date: entry.date,
      description: entry.description,
      amount: money(entry.amount),
      cleared: entry.cleared,
    }));
    return {
      account_id: accountId,
      account_name: "Nubank",
      currency_code: "BRL",
      statement_date: date,
      statement_balance: money(balance),
      cleared_balance: money(cleared),
      difference: money(difference),
      book_balance: money(state.opening + state.entries.filter((entry) => entry.date <= date).reduce((sum, entry) => sum + entry.amount, 0)),
      reconciled: difference === 0,
      rows,
      total_rows: rows.length,
      truncated: false,
    };
  }

  const historyOut = (): ClosedReconciliation[] =>
    state.history.map((record) => ({
      id: record.id,
      account_id: accountId,
      statement_date: record.statement_date,
      statement_balance: record.statement_balance,
      closed_at: record.closed_at,
      invalidated_at: record.invalidated_at,
      locked_count: record.invalidated_at ? 0 : record.locked.length,
    }));

  const handlers = [
    http.get("*/api/v1/reconciliation/:account/history", () => {
      state.requests.push({ method: "GET", path: "/history" });
      return HttpResponse.json(historyOut());
    }),

    http.get("*/api/v1/reconciliation/:account", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/view", query: Object.fromEntries(query.entries()) });
      if (state.viewError) return fail({ status: 500, code: "internal_error" });
      return HttpResponse.json(view(Number(query.get("statement_balance")), query.get("statement_date") ?? "2026-03-31"));
    }),

    http.put("*/api/v1/reconciliation/:account/cleared", async ({ request }) => {
      const body = (await request.json()) as { split_ids: string[]; cleared: boolean };
      state.requests.push({ method: "PUT", path: "/cleared", body });
      if (state.hold) await state.hold;
      const error = takeError();
      if (error) return fail(error);
      const chosen = state.entries.filter((entry) => body.split_ids.includes(entry.id));
      if (chosen.some((entry) => entry.locked && !body.cleared)) return fail({ status: 409, code: "transaction_locked" });
      let changed = 0;
      for (const entry of chosen) {
        if (entry.cleared !== body.cleared) {
          entry.cleared = body.cleared;
          changed += 1;
        }
      }
      return HttpResponse.json({ changed });
    }),

    http.post("*/api/v1/reconciliation/:account/adjustment", async ({ request }) => {
      const body = (await request.json()) as { statement_balance: string; statement_date: string };
      state.requests.push({ method: "POST", path: "/adjustment", body });
      const error = takeError();
      if (error) return fail(error);
      const difference = Math.round((Number(body.statement_balance) - clearedBalance(body.statement_date)) * 100) / 100;
      if (difference === 0) return fail({ status: 400, code: "reconciliation_no_difference" });
      state.entries.push(makeEntry("Ajuste de conciliacao", difference, { date: body.statement_date, cleared: true }));
      return HttpResponse.json(view(Number(body.statement_balance), body.statement_date), { status: 201 });
    }),

    http.post("*/api/v1/reconciliation/:account/close", async ({ request }) => {
      const body = (await request.json()) as { statement_balance: string; statement_date: string };
      state.requests.push({ method: "POST", path: "/close", body });
      const error = takeError();
      if (error) return fail(error);
      if (Math.round((Number(body.statement_balance) - clearedBalance(body.statement_date)) * 100) / 100 !== 0) {
        return fail({ status: 400, code: "reconciliation_difference" });
      }
      const toLock = state.entries.filter((entry) => entry.cleared && !entry.locked && entry.date <= body.statement_date);
      if (toLock.length === 0) return fail({ status: 400, code: "reconciliation_nothing" });
      for (const entry of toLock) entry.locked = true;
      const record: ClosedRecord = {
        id: `60000000-0000-4000-8000-${String(state.history.length + 1).padStart(12, "0")}`,
        statement_date: body.statement_date,
        statement_balance: money(Number(body.statement_balance)),
        closed_at: "2026-03-31T12:00:00Z",
        invalidated_at: null,
        locked: toLock.map((entry) => entry.id),
      };
      state.history.unshift(record);
      return HttpResponse.json(historyOut()[0], { status: 201 });
    }),

    http.delete("*/api/v1/reconciliation/:account/closed/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", path: `/closed/${params.id}` });
      const error = takeError();
      if (error) return fail(error);
      const record = state.history.find((item) => item.id === params.id);
      if (!record) return fail({ status: 404, code: "reconciliation_not_found" });
      for (const entry of state.entries) if (record.locked.includes(entry.id)) entry.locked = false;
      record.invalidated_at = "2026-03-31T13:00:00Z";
      return HttpResponse.json({ changed: record.locked.length });
    }),
  ];

  const mutations = () => state.requests.filter((request) => request.method !== "GET");
  return { handlers, state, mutations };
}

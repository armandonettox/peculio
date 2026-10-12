import { http, HttpResponse } from "msw";

import type { Recurrence, RecurrenceStatus } from "@/api/recurrences";

let counter = 0;

type Template = Recurrence["template"];
type TemplateSplit = NonNullable<Template>["splits"][number];

/** Uma linha de modelo: saida de aluguel por padrao. */
export function makeTemplateSplit(overrides: Partial<TemplateSplit> = {}): TemplateSplit {
  return {
    type: "withdrawal",
    date: "2026-03-05",
    description: "Aluguel",
    amount: "1500.00",
    currency_code: "BRL",
    account_id: "a0000000-0000-4000-8000-000000000001",
    counterparty_name: "Imobiliaria",
    tag_ids: [],
    ...overrides,
  } as TemplateSplit;
}

/** Recorrente do modo automatico (cria o lancamento sozinha). */
export function makeRecurrence(overrides: Partial<Recurrence> = {}): Recurrence {
  counter += 1;
  return {
    id: `f0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Recorrente ${counter}`,
    frequency: "monthly",
    first_date: "2026-03-05",
    end_date: null,
    max_occurrences: null,
    active: true,
    auto_create: true,
    template: { splits: [makeTemplateSplit()] } as Template,
    currency_code: null,
    amount_min: null,
    amount_max: null,
    match_text: null,
    created_count: 1,
    next_date: "2026-04-05",
    ended: false,
    last_error: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Recorrente do modo de lembrete, com a situacao ja calculada (o teste escolhe `status`, datas e `next_due_paid`). */
export function makeReminder(overrides: Partial<RecurrenceStatus> = {}): RecurrenceStatus {
  counter += 1;
  return {
    id: `d0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Conta ${counter}`,
    frequency: "monthly",
    first_date: "2026-03-05",
    end_date: null,
    max_occurrences: null,
    active: true,
    auto_create: false,
    template: null,
    currency_code: "BRL",
    amount_min: "40.00",
    amount_max: "60.00",
    match_text: "netflix",
    created_count: 0,
    next_date: null,
    ended: false,
    last_error: null,
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

type Item = Recurrence | RecurrenceStatus;
type NextError = { status: number; code: string; errors?: { field: string; message: string }[] };
type Recorded = { method: string; path: string; body?: Record<string, unknown>; query?: URLSearchParams };

/**
 * API de recorrentes de mentira, com estado, cobrindo os dois modos (automatico e lembrete). A
 * criacao automatica nao gera lancamentos (isso e do backend): o teste escreve o `created_count`
 * e as datas que quer ver. A situacao de cada lembrete e a que o teste escreveu; a API falsa nao
 * recalcula vencimentos (isso e testado no backend).
 */
export function fakeRecurrencesApi(initial: Item[] = []) {
  const state = {
    items: [...initial] as Item[],
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
    state.items.some((item) => item.id !== ignoreId && item.name.toLowerCase() === name.trim().toLowerCase());
  const byName = (items: Item[]) => [...items].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const handlers = [
    http.get("*/api/v1/recurrences/status", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/recurrences/status", query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const archived = query.get("include_archived") === "true";
      const reminders = state.items.filter((item): item is RecurrenceStatus => !item.auto_create && (archived || item.active));
      const sorted = [...reminders].sort(
        (a, b) => a.next_due_date.localeCompare(b.next_due_date) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      );
      return HttpResponse.json(sorted);
    }),

    http.get("*/api/v1/recurrences", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/recurrences", query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const onlyActive = query.get("active") === "true";
      const items = byName(state.items.filter((item) => !onlyActive || item.active));
      return HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 });
    }),

    http.post("*/api/v1/recurrences", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "POST", path: "/recurrences", body });
      const error = takeError();
      if (error) return fail(error);
      if (taken(String(body.name))) return fail({ status: 409, code: "bill_name_taken" });
      const autoCreate = body.auto_create !== false;
      const created: Item = autoCreate
        ? makeRecurrence({
            name: String(body.name),
            frequency: body.frequency as Recurrence["frequency"],
            first_date: String(body.first_date),
            end_date: (body.end_date as string | null) ?? null,
            max_occurrences: (body.max_occurrences as number | null) ?? null,
            template: body.template as Template,
            created_count: 0,
            next_date: String(body.first_date),
          })
        : makeReminder({
            name: String(body.name),
            currency_code: String(body.currency_code),
            amount_min: String(body.amount_min),
            amount_max: String(body.amount_max),
            match_text: (body.match_text as string | null) ?? null,
            first_date: String(body.first_date),
            frequency: body.frequency as RecurrenceStatus["frequency"],
            last_due_date: null,
            next_due_date: String(body.first_date),
            status: "upcoming",
          });
      state.items.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.patch("*/api/v1/recurrences/:id", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "PATCH", path: `/recurrences/${params.id}`, body });
      const error = takeError();
      if (error) return fail(error);
      const index = state.items.findIndex((item) => item.id === params.id);
      if (index < 0) return fail({ status: 404, code: "recurrence_not_found" });
      if (typeof body.name === "string" && taken(body.name, String(params.id))) {
        return fail({ status: 409, code: "bill_name_taken" });
      }
      state.items[index] = { ...state.items[index], ...body } as Item;
      return HttpResponse.json(state.items[index]);
    }),

    http.delete("*/api/v1/recurrences/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", path: `/recurrences/${params.id}` });
      const error = takeError();
      if (error) return fail(error);
      state.items = state.items.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const mutations = () => state.requests.filter((request) => request.method !== "GET");
  const listRequests = () => state.requests.filter((request) => request.method === "GET");
  const statusRequests = () => state.requests.filter((request) => request.path === "/recurrences/status");
  return { handlers, state, mutations, listRequests, statusRequests };
}

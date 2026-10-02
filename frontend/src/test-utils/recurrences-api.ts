import { http, HttpResponse } from "msw";

import type { Recurrence } from "@/api/recurrences";

let counter = 0;

type Template = Recurrence["template"];
type TemplateSplit = Template["splits"][number];

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
    template: { splits: [makeTemplateSplit()] } as Template,
    created_count: 1,
    next_date: "2026-04-05",
    ended: false,
    last_error: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

type NextError = { status: number; code: string };
type Recorded = { method: string; path: string; body?: Record<string, unknown>; query?: URLSearchParams };

/**
 * API de recorrentes de mentira, com estado. A criacao nao gera lancamentos (isso e do backend):
 * o teste escreve o `created_count` e as datas que quer ver.
 */
export function fakeRecurrencesApi(initial: Recurrence[] = []) {
  const state = {
    items: [...initial],
    requests: [] as Recorded[],
    nextMutationError: null as NextError | null,
    listError: false,
  };

  const fail = (error: NextError) => HttpResponse.json({ detail: "erro", code: error.code }, { status: error.status });
  const takeError = () => {
    const error = state.nextMutationError;
    state.nextMutationError = null;
    return error;
  };

  const handlers = [
    http.get("*/api/v1/recurrences", ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: "/recurrences", query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const onlyActive = query.get("active") === "true";
      const items = [...state.items]
        .filter((item) => !onlyActive || item.active)
        .sort((a, b) => (a.next_date ?? "9999").localeCompare(b.next_date ?? "9999"));
      return HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 });
    }),

    http.post("*/api/v1/recurrences", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "POST", path: "/recurrences", body });
      const error = takeError();
      if (error) return fail(error);
      const created = makeRecurrence({
        name: String(body.name),
        frequency: body.frequency as Recurrence["frequency"],
        first_date: String(body.first_date),
        end_date: (body.end_date as string | null) ?? null,
        max_occurrences: (body.max_occurrences as number | null) ?? null,
        template: body.template as Template,
        created_count: 0,
        next_date: String(body.first_date),
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
      state.items[index] = { ...state.items[index], ...body } as Recurrence;
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
  return { handlers, state, mutations, listRequests };
}

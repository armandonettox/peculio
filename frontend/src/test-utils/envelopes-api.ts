import { http, HttpResponse } from "msw";

import type { Envelope, EnvelopeGroup, EnvelopeMonth } from "@/api/envelopes";

let counter = 0;

const money = (value: number) => value.toFixed(2);

type Figures = { carried: number; allocated: number; spent: number };

/** Envelope com os numeros de entrada; `available` e `overspent` saem da mesma conta do backend. */
export function makeEnvelope(name: string, figures: Partial<Figures> = {}): Envelope {
  counter += 1;
  const { carried = 0, allocated = 0, spent = 0 } = figures;
  return fromFigures(`e0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`, name, { carried, allocated, spent });
}

function fromFigures(id: string, name: string, { carried, allocated, spent }: Figures): Envelope {
  const available = carried + allocated - spent;
  return {
    budget_id: id,
    name,
    carried: money(carried),
    allocated: money(allocated),
    spent: money(spent),
    available: money(available),
    overspent: money(available < 0 ? -available : 0),
  };
}

type NextError = { status: number; code: string; detail?: string };
type Recorded = { method: string; path: string; body?: Record<string, unknown>; month?: string | null };

/**
 * API de envelopes de mentira, com estado, de uma moeda so (BRL). Distribuir e mover refazem a conta do backend:
 * disponivel = passou + distribuido - gasto, e "A orcar" = dinheiro - soma dos disponiveis positivos. O mes pedido
 * e so anotado: os numeros valem para qualquer mes.
 */
export function fakeEnvelopesApi(initial: Envelope[] = [], { moneyAmount = 1000 }: { moneyAmount?: number } = {}) {
  const state = {
    figures: new Map<string, Figures>(
      initial.map((item) => [
        item.budget_id,
        { carried: Number(item.carried), allocated: Number(item.allocated), spent: Number(item.spent) },
      ]),
    ),
    names: new Map(initial.map((item) => [item.budget_id, item.name])),
    money: moneyAmount,
    requests: [] as Recorded[],
    viewError: false,
    nextMutationError: null as NextError | null,
  };

  const fail = (error: NextError) =>
    HttpResponse.json({ detail: error.detail ?? "erro", code: error.code }, { status: error.status });

  function view(month: string): EnvelopeMonth {
    const envelopes = [...state.figures.entries()].map(([id, figures]) => fromFigures(id, state.names.get(id) ?? "", figures));
    const inEnvelopes = envelopes.reduce((sum, item) => sum + Math.max(Number(item.available), 0), 0);
    const groups: EnvelopeGroup[] =
      envelopes.length === 0
        ? []
        : [
            {
              currency_code: "BRL",
              money: money(state.money),
              in_envelopes: money(inEnvelopes),
              to_budget: money(state.money - inEnvelopes),
              envelopes,
            },
          ];
    return { month: `${month}-01`, groups };
  }

  const takeError = () => {
    const error = state.nextMutationError;
    state.nextMutationError = null;
    return error;
  };

  const handlers = [
    http.get("*/api/v1/envelopes", ({ request }) => {
      const month = new URL(request.url).searchParams.get("month");
      state.requests.push({ method: "GET", path: "/envelopes", month });
      if (state.viewError) return fail({ status: 500, code: "internal_error" });
      return HttpResponse.json(view(month ?? "2026-03"));
    }),

    http.post("*/api/v1/envelopes/move", async ({ request }) => {
      const body = (await request.json()) as { from_budget_id: string; to_budget_id: string; month: string; amount: string };
      state.requests.push({ method: "POST", path: "/envelopes/move", body: body as unknown as Record<string, unknown> });
      const error = takeError();
      if (error) return fail(error);
      const from = state.figures.get(body.from_budget_id);
      const to = state.figures.get(body.to_budget_id);
      if (!from || !to) return fail({ status: 404, code: "budget_not_found" });
      const amount = Number(body.amount);
      if (from.carried + from.allocated - from.spent < amount) return fail({ status: 400, code: "envelope_not_enough" });
      from.allocated -= amount;
      to.allocated += amount;
      return HttpResponse.json(view(body.month));
    }),

    http.put("*/api/v1/envelopes/:id/:month", async ({ request, params }) => {
      const body = (await request.json()) as { amount: string };
      state.requests.push({
        method: "PUT",
        path: `/envelopes/${params.id}/${params.month}`,
        body: body as unknown as Record<string, unknown>,
      });
      const error = takeError();
      if (error) return fail(error);
      const figures = state.figures.get(String(params.id));
      if (!figures) return fail({ status: 404, code: "budget_not_found" });
      figures.allocated = Number(body.amount);
      return HttpResponse.json(view(String(params.month)));
    }),
  ];

  const mutations = () => state.requests.filter((request) => request.method !== "GET");
  return { handlers, state, mutations };
}

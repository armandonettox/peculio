import { http, HttpResponse } from "msw";

import type { CardCounting, MonthlyPlan, PlanRow } from "@/api/plans";

type FakeItem = { category_id: string; name: string; amount: string; alert: boolean };
type FakePlan = {
  income: string;
  savings_percent: string;
  card_counting: CardCounting;
  items: FakeItem[];
};

export type FakeCategory = { id: string; name: string };
type Recorded = { method: string; path: string; body?: Record<string, unknown> };

const money = (value: number) => value.toFixed(2);

/** Monta a resposta do plano a partir do estado, sem gasto algum (a conta do gasto e testada no backend). */
function build(month: string, plan: FakePlan): MonthlyPlan {
  const income = Number(plan.income);
  const percent = Number(plan.savings_percent);
  const budget = (income * (100 - percent)) / 100;
  const limited = plan.items.reduce((total, item) => total + Number(item.amount), 0);
  const rows: PlanRow[] = plan.items.map((item) => ({
    category_id: item.category_id,
    category_name: item.name,
    category_color: null,
    category_icon: null,
    kind: "category",
    planned: money(Number(item.amount)),
    paid: "0.00",
    expected: "0.00",
    total: "0.00",
    remaining: money(Number(item.amount)),
    alert: item.alert,
    state: "ok",
  }));
  rows.push({
    category_id: null,
    category_name: null,
    category_color: null,
    category_icon: null,
    kind: "rest",
    planned: money(budget - limited),
    paid: "0.00",
    expected: "0.00",
    total: "0.00",
    remaining: money(budget - limited),
    alert: false,
    state: "ok",
  });
  return {
    month: `${month}-01`,
    currency_code: "BRL",
    income: money(income),
    savings_percent: money(percent),
    card_counting: plan.card_counting,
    spending_budget: money(budget),
    savings_amount: money(income - budget),
    summary: {
      month_income: money(income),
      planned_spending: money(budget),
      planned_balance: money(income - budget),
      planned_savings_percent: money(percent),
      spent_paid: "0.00",
      spent_expected: "0.00",
      spent_total: "0.00",
      remaining: money(budget),
    },
    rows,
  };
}

function previousMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Valor da API que o formulario manda como texto ou numero, sempre como "1500.00". */
const asText = (value: unknown) => money(Number(value));

/**
 * API de planejamento mensal de mentira, com estado: um plano por mes, com os limites por categoria. Mes sem plano
 * responde 404 com o codigo `monthly_plan_not_found`, como o backend.
 */
export function fakePlansApi(initial: Record<string, FakePlan> = {}, categories: FakeCategory[] = []) {
  const state = { plans: { ...initial } as Record<string, FakePlan>, requests: [] as Recorded[] };
  const nameOf = (id: string) => categories.find((item) => item.id === id)?.name ?? id;
  const missing = () => HttpResponse.json({ detail: "sem plano", code: "monthly_plan_not_found" }, { status: 404 });
  const record = (method: string, path: string, body?: Record<string, unknown>) =>
    state.requests.push({ method, path, body });

  const handlers = [
    http.get("*/api/v1/plans/monthly/:month", ({ params }) => {
      const month = String(params.month);
      record("GET", `/plans/monthly/${month}`);
      const plan = state.plans[month];
      return plan ? HttpResponse.json(build(month, plan)) : missing();
    }),

    http.post("*/api/v1/plans/monthly/:month/copy-previous", ({ params }) => {
      const month = String(params.month);
      record("POST", `/plans/monthly/${month}/copy-previous`);
      const source = state.plans[previousMonth(month)];
      if (!source) return missing();
      state.plans[month] = { ...source, items: source.items.map((item) => ({ ...item })) };
      return HttpResponse.json(build(month, state.plans[month]), { status: 201 });
    }),

    http.post("*/api/v1/plans/monthly/:month", async ({ params, request }) => {
      const month = String(params.month);
      const body = (await request.json()) as Record<string, unknown>;
      record("POST", `/plans/monthly/${month}`, body);
      if (state.plans[month]) {
        return HttpResponse.json({ detail: "ja existe", code: "monthly_plan_exists" }, { status: 409 });
      }
      const items = ((body.items as { category_id: string; amount: unknown; alert?: boolean }[]) ?? []).map((item) => ({
        category_id: item.category_id,
        name: nameOf(item.category_id),
        amount: asText(item.amount),
        alert: item.alert ?? false,
      }));
      state.plans[month] = {
        income: asText(body.income),
        savings_percent: asText(body.savings_percent ?? 0),
        card_counting: (body.card_counting as CardCounting) ?? "purchase",
        items,
      };
      return HttpResponse.json(build(month, state.plans[month]), { status: 201 });
    }),

    http.patch("*/api/v1/plans/monthly/:month", async ({ params, request }) => {
      const month = String(params.month);
      const body = (await request.json()) as Record<string, unknown>;
      record("PATCH", `/plans/monthly/${month}`, body);
      const plan = state.plans[month];
      if (!plan) return missing();
      if (body.income != null) plan.income = asText(body.income);
      if (body.savings_percent != null) plan.savings_percent = asText(body.savings_percent);
      if (body.card_counting != null) plan.card_counting = body.card_counting as CardCounting;
      return HttpResponse.json(build(month, plan));
    }),

    http.put("*/api/v1/plans/monthly/:month/items", async ({ params, request }) => {
      const month = String(params.month);
      const body = (await request.json()) as { items: { category_id: string; amount: unknown; alert?: boolean }[] };
      record("PUT", `/plans/monthly/${month}/items`, body as unknown as Record<string, unknown>);
      const plan = state.plans[month];
      if (!plan) return missing();
      for (const item of body.items) {
        const next = { category_id: item.category_id, name: nameOf(item.category_id), amount: asText(item.amount), alert: item.alert ?? false };
        const index = plan.items.findIndex((existing) => existing.category_id === item.category_id);
        if (index >= 0) plan.items[index] = next;
        else plan.items.push(next);
      }
      return HttpResponse.json(build(month, plan));
    }),

    http.delete("*/api/v1/plans/monthly/:month/items/:categoryId", ({ params }) => {
      const month = String(params.month);
      record("DELETE", `/plans/monthly/${month}/items/${String(params.categoryId)}`);
      const plan = state.plans[month];
      if (!plan) return missing();
      plan.items = plan.items.filter((item) => item.category_id !== params.categoryId);
      return HttpResponse.json(build(month, plan));
    }),

    http.delete("*/api/v1/plans/monthly", () => {
      record("DELETE", "/plans/monthly");
      state.plans = {};
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return { handlers, state };
}

export function makeFakePlan(overrides: Partial<FakePlan> = {}): FakePlan {
  return { income: "5000.00", savings_percent: "20.00", card_counting: "purchase", items: [], ...overrides };
}

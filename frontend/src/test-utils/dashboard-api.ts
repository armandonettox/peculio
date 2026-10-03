import { http, HttpResponse } from "msw";

import type { NetWorth, NetWorthCurrency, Upcoming, UpcomingItem } from "@/api/dashboard";

let counter = 0;

const pad = (value: number) => String(value).padStart(2, "0");

/** Meses AAAA-MM terminando em `last`, do mais antigo ao mais recente. */
export function monthsEndingAt(last: string, count: number): string[] {
  const [year, month] = last.split("-").map(Number);
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const index = year * 12 + (month - 1) - back;
    months.push(`${Math.floor(index / 12)}-${pad((index % 12) + 1)}`);
  }
  return months;
}

/**
 * Patrimonio de uma moeda a partir da serie de `net` (texto decimal). Ativos e dividas saem de `debt`
 * (valor devido, positivo) para o teste nao precisar escrever tudo: assets = net + debt.
 */
export function makeNetWorthCurrency(
  currency: string,
  nets: string[],
  { debt = "0.00", last = "2026-03" }: { debt?: string; last?: string } = {},
): NetWorthCurrency {
  const months = monthsEndingAt(last, nets.length);
  const series = nets.map((net, index) => {
    const assets = (Number(net) + Number(debt)).toFixed(2);
    return { month: months[index], assets, liabilities: (-Number(debt)).toFixed(2), net };
  });
  const current = series[series.length - 1];
  return { currency_code: currency, assets: current.assets, liabilities: current.liabilities, net: current.net, series };
}

export function makeNetWorth(overrides: Partial<NetWorth> = {}): NetWorth {
  const currencies = overrides.currencies ?? [
    makeNetWorthCurrency("BRL", ["10000.00", "10500.00", "9800.00", "12000.50"], { debt: "2000.00" }),
  ];
  return { as_of: "2026-03-15", months: currencies[0]?.series.length ?? 12, currencies, ...overrides };
}

export function makeUpcomingItem(overrides: Partial<UpcomingItem> = {}): UpcomingItem {
  counter += 1;
  return {
    kind: "bill",
    id: `d0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Conta ${counter}`,
    date: "2026-03-20",
    days_until: 5,
    overdue: false,
    direction: "out",
    currency_code: "BRL",
    amount_min: "40.00",
    amount_max: "60.00",
    ...overrides,
  };
}

export function makeUpcoming(overrides: Partial<Upcoming> = {}): Upcoming {
  return { as_of: "2026-03-15", days: 30, items: [], ...overrides };
}

type NextError = { status: number; code: string };
type Recorded = { path: string; query: URLSearchParams };

/**
 * API do painel de mentira: devolve o que o teste escolheu e guarda os pedidos para conferir os
 * parametros. `errors` falha o proximo pedido de cada rota, uma vez.
 */
export function fakeDashboardApi(initial: { netWorth?: NetWorth; upcoming?: Upcoming } = {}) {
  const state = {
    netWorth: initial.netWorth ?? makeNetWorth(),
    upcoming: initial.upcoming ?? makeUpcoming(),
    requests: [] as Recorded[],
    netWorthError: null as NextError | null,
    upcomingError: null as NextError | null,
  };

  const fail = (error: NextError) =>
    HttpResponse.json({ detail: "erro", code: error.code }, { status: error.status });

  const handlers = [
    http.get("*/api/v1/dashboard/net-worth", ({ request }) => {
      state.requests.push({ path: "net-worth", query: new URL(request.url).searchParams });
      const error = state.netWorthError;
      state.netWorthError = null;
      return error ? fail(error) : HttpResponse.json(state.netWorth);
    }),
    http.get("*/api/v1/dashboard/upcoming", ({ request }) => {
      state.requests.push({ path: "upcoming", query: new URL(request.url).searchParams });
      const error = state.upcomingError;
      state.upcomingError = null;
      return error ? fail(error) : HttpResponse.json(state.upcoming);
    }),
  ];

  const requestsTo = (path: string) => state.requests.filter((request) => request.path === path);
  return { handlers, state, requestsTo };
}

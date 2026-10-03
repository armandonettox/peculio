import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { dashboardKey } from "./query-keys";
import type { components } from "./schema";

export type NetWorth = components["schemas"]["NetWorthOut"];
export type NetWorthCurrency = components["schemas"]["NetWorthCurrency"];
export type NetWorthPoint = components["schemas"]["NetWorthPoint"];
export type Upcoming = components["schemas"]["UpcomingOut"];
export type UpcomingItem = components["schemas"]["UpcomingItem"];

export { dashboardKey };

/** Patrimonio de hoje e a evolucao mes a mes, por moeda. */
export function useNetWorth({ months = 12 }: { months?: number } = {}) {
  return useQuery({
    queryKey: [...dashboardKey, "net-worth", { months }],
    queryFn: () => unwrap(api.client.GET("/api/v1/dashboard/net-worth", { params: { query: { months } } })),
  });
}

/** Contas a pagar e recorrentes dos proximos dias, mais as atrasadas. */
export function useUpcoming({ days = 30 }: { days?: number } = {}) {
  return useQuery({
    queryKey: [...dashboardKey, "upcoming", { days }],
    queryFn: () => unwrap(api.client.GET("/api/v1/dashboard/upcoming", { params: { query: { days } } })),
  });
}

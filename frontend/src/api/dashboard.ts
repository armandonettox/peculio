import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { dashboardKey } from "./query-keys";
import type { components } from "./schema";

export type NetWorth = components["schemas"]["NetWorthOut"];
export type NetWorthCurrency = components["schemas"]["NetWorthCurrency"];
export type NetWorthPoint = components["schemas"]["NetWorthPoint"];
export type Upcoming = components["schemas"]["UpcomingOut"];
export type UpcomingItem = components["schemas"]["UpcomingItem"];
export type SpendingForecast = components["schemas"]["SpendingForecastOut"];
export type SpendingForecastCurrency = components["schemas"]["SpendingForecastCurrency"];
export type SpendingForecastPoint = components["schemas"]["SpendingForecastPoint"];

export { dashboardKey };

/** Patrimonio de hoje e a evolucao mes a mes, por moeda. */
export function useNetWorth({ months = 12, forecastMonths = 0 }: { months?: number; forecastMonths?: number } = {}) {
  return useQuery({
    queryKey: [...dashboardKey, "net-worth", { months, forecastMonths }],
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/dashboard/net-worth", {
          params: { query: { months, forecast_months: forecastMonths } },
        }),
      ),
  });
}

/** Projecao de receitas e despesas dos proximos meses pelas recorrencias auto_create ativas. */
export function useSpendingForecast({ months = 3 }: { months?: number } = {}, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...dashboardKey, "spending-forecast", { months }],
    enabled,
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/dashboard/spending-forecast", {
          params: { query: { months } },
        }),
      ),
  });
}

/** Contas a pagar e recorrentes dos proximos dias, mais as atrasadas. */
export function useUpcoming({ days = 30 }: { days?: number } = {}) {
  return useQuery({
    queryKey: [...dashboardKey, "upcoming", { days }],
    queryFn: () => unwrap(api.client.GET("/api/v1/dashboard/upcoming", { params: { query: { days } } })),
  });
}

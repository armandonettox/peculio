import { useQuery } from "@tanstack/react-query";

import { syncAppClock } from "@/lib/app-clock";
import { api, unwrap } from "./client";
import { clockKey } from "./query-keys";
import type { components } from "./schema";

export type AppClock = components["schemas"]["ClockOut"];

export { clockKey };

/**
 * Sincroniza o "hoje" do app com o servidor. A sincronizacao acontece dentro da consulta; quem le o dia
 * usa `appToday()`. Sem rede ou com erro, o app segue com o relogio do aparelho.
 */
export function useAppClock() {
  return useQuery({
    queryKey: clockKey,
    queryFn: async () => {
      const clock = await unwrap(api.client.GET("/api/v1/clock"));
      syncAppClock(clock);
      return clock;
    },
    staleTime: 10 * 60_000,
    retry: false,
  });
}

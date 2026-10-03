import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { dashboardKey } from "./query-keys";
import type { components } from "./schema";

export type Account = components["schemas"]["AccountOut"];
export type AccountCreate = components["schemas"]["AccountCreate"];
export type AccountUpdate = components["schemas"]["AccountUpdate"];
export type Currency = components["schemas"]["CurrencyOut"];

export const accountsKey = ["accounts"] as const;
export const currenciesKey = ["currencies"] as const;

// Criar, mudar ou apagar uma conta muda o patrimonio e os vencimentos do painel
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: accountsKey }),
      queryClient.invalidateQueries({ queryKey: dashboardKey }),
    ]);
}

// Quem tem mais de 200 contas e raro; a tela busca tudo de uma vez (o maximo da API)
const PAGE_LIMIT = 200;

export function useAccounts({ includeArchived }: { includeArchived: boolean }) {
  return useQuery({
    queryKey: [...accountsKey, { includeArchived }],
    queryFn: async () => {
      const query = includeArchived ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, active: true };
      const page = await unwrap(api.client.GET("/api/v1/accounts", { params: { query } }));
      return page.items;
    },
  });
}

export function useCurrencies() {
  return useQuery({
    queryKey: currenciesKey,
    queryFn: () => unwrap(api.client.GET("/api/v1/currencies")),
    // A lista de moedas so muda com uma nova versao do app
    staleTime: Infinity,
  });
}

export function useCreateAccount() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: AccountCreate) => unwrap(api.client.POST("/api/v1/accounts", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateAccount() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AccountUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/accounts/{account_id}", { params: { path: { account_id: id } }, body })),
    onSuccess: refresh,
  });
}

export function useDeleteAccount() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/accounts/{account_id}", { params: { path: { account_id: id } } })),
    onSuccess: refresh,
  });
}

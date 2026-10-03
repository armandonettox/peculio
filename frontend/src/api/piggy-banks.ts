import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { piggyBanksKey } from "./query-keys";
import type { components } from "./schema";

export type PiggyBank = components["schemas"]["PiggyBankOut"];
export type PiggyBankCreate = components["schemas"]["PiggyBankCreate"];
export type PiggyBankUpdate = components["schemas"]["PiggyBankUpdate"];
export type PiggyBankEvent = components["schemas"]["PiggyBankEventOut"];
export type PiggyBankEventCreate = components["schemas"]["PiggyBankEventCreate"];

export { piggyBanksKey };

// Quem tem mais de 200 cofrinhos e raro; a tela busca tudo de uma vez (o maximo da API)
const PAGE_LIMIT = 200;
// Quantos movimentos o historico mostra (os mais recentes)
export const HISTORY_LIMIT = 50;

// Arquivados ficam fora da lista, a menos que a tela peca; o guardado deles continua reservado na conta
export function usePiggyBanks({ includeArchived = false }: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: [...piggyBanksKey, "list", { includeArchived }],
    queryFn: async () => {
      const query = includeArchived ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, active: true };
      const page = await unwrap(api.client.GET("/api/v1/piggy-banks", { params: { query } }));
      return page.items;
    },
  });
}

export function usePiggyBankEvents(id: string) {
  return useQuery({
    queryKey: [...piggyBanksKey, "events", id],
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/piggy-banks/{piggy_bank_id}/events", {
          params: { path: { piggy_bank_id: id }, query: { limit: HISTORY_LIMIT } },
        }),
      ),
  });
}

// Guardar ou retirar muda o guardado e o disponivel de todos os cofrinhos da conta
function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: piggyBanksKey });
}

export function useCreatePiggyBank() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: PiggyBankCreate) => unwrap(api.client.POST("/api/v1/piggy-banks", { body })),
    onSuccess: refresh,
  });
}

export function useUpdatePiggyBank() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PiggyBankUpdate }) =>
      unwrap(
        api.client.PATCH("/api/v1/piggy-banks/{piggy_bank_id}", { params: { path: { piggy_bank_id: id } }, body }),
      ),
    onSuccess: refresh,
  });
}

export function useDeletePiggyBank() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/piggy-banks/{piggy_bank_id}", { params: { path: { piggy_bank_id: id } } })),
    onSuccess: refresh,
  });
}

export function useAddPiggyBankEvent() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PiggyBankEventCreate }) =>
      unwrap(
        api.client.POST("/api/v1/piggy-banks/{piggy_bank_id}/events", {
          params: { path: { piggy_bank_id: id } },
          body,
        }),
      ),
    onSuccess: refresh,
  });
}

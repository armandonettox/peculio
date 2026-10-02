import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { billsKey } from "./query-keys";
import type { components } from "./schema";
import { transactionsKey } from "./transactions";

export type Bill = components["schemas"]["BillOut"];
export type BillStatus = components["schemas"]["BillStatusOut"];
export type BillCreate = components["schemas"]["BillCreate"];
export type BillUpdate = components["schemas"]["BillUpdate"];
export type BillFrequency = components["schemas"]["BillFrequency"];

export { billsKey };

// Quem tem mais de 200 contas a pagar e raro; a tela busca tudo de uma vez (o maximo da API)
const PAGE_LIMIT = 200;

/** Contas a pagar com o ultimo e o proximo vencimento e se o ultimo foi pago (data `on`: AAAA-MM-DD). */
export function useBillsStatus({ on, includeArchived }: { on: string; includeArchived: boolean }) {
  return useQuery({
    queryKey: [...billsKey, "status", { on, includeArchived }],
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/bills/status", {
          params: { query: { on, include_archived: includeArchived } },
        }),
      ),
  });
}

/** Lista simples, para escolher uma conta a pagar no formulario de lancamento. */
export function useBills({ activeOnly }: { activeOnly: boolean }) {
  return useQuery({
    queryKey: [...billsKey, "list", { activeOnly }],
    queryFn: async () => {
      const query = activeOnly ? { limit: PAGE_LIMIT, active: true } : { limit: PAGE_LIMIT };
      const page = await unwrap(api.client.GET("/api/v1/bills", { params: { query } }));
      return page.items;
    },
  });
}

// Mudar uma conta a pagar muda a situacao; excluir tambem solta os lancamentos ligados a ela
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: billsKey }),
      queryClient.invalidateQueries({ queryKey: transactionsKey }),
    ]);
}

export function useCreateBill() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: BillCreate) => unwrap(api.client.POST("/api/v1/bills", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateBill() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: BillUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/bills/{bill_id}", { params: { path: { bill_id: id } }, body })),
    onSuccess: refresh,
  });
}

export function useDeleteBill() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/bills/{bill_id}", { params: { path: { bill_id: id } } })),
    onSuccess: refresh,
  });
}

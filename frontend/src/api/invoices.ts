import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { invoicesKey } from "./query-keys";
import type { components } from "./schema";

export type Invoice = components["schemas"]["InvoiceOut"];

/** Fatura do cartao (role=credit_card com fechamento/vencimento configurados) que contem `on`. */
export function useInvoice({ accountId, on }: { accountId: string; on: string }) {
  return useQuery({
    queryKey: [...invoicesKey, accountId, on],
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/accounts/{account_id}/invoice", {
          params: { path: { account_id: accountId }, query: { on } },
        }),
      ),
    enabled: Boolean(accountId),
  });
}

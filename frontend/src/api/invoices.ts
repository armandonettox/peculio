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

export type InvoiceOption = components["schemas"]["InvoiceOptionOut"];

/**
 * As faturas oferecidas ao escolher onde lancar uma compra no cartao: a aberta, algumas passadas e as proximas, mais a
 * que contem `around` (a data da compra). Sem cartao escolhido, nao busca.
 */
export function useInvoiceOptions({ accountId, around, enabled = true }: { accountId: string; around: string; enabled?: boolean }) {
  return useQuery({
    queryKey: [...invoicesKey, "options", accountId, around],
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/accounts/{account_id}/invoices", {
          params: { path: { account_id: accountId }, query: { around } },
        }),
      ),
    enabled: enabled && Boolean(accountId),
  });
}

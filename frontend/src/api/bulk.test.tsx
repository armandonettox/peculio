import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { expect, it } from "vitest";

import { server } from "@/test-utils/msw";
import { accountsKey } from "./accounts";
import { useBulkTransactions } from "./bulk";
import { dashboardKey } from "./dashboard";
import { billsKey, budgetsKey, reportsKey, webhooksKey } from "./query-keys";
import { reconciliationKey } from "./reconciliation";
import { counterpartiesKey, transactionsKey } from "./transactions";

// Uma acao em massa muda lancamentos como a edicao comum, e a conciliacao mostra os mesmos lancamentos: tudo isso
// precisa ser marcado como desatualizado. O teste planta uma consulta de cada assunto (e uma de outro) e confere.

const KEYS = {
  transactions: [...transactionsKey, "lista"],
  accounts: [...accountsKey, "lista"],
  counterparties: [...counterpartiesKey, "expense", ""],
  budgets: [...budgetsKey, "lista"],
  bills: [...billsKey, "lista"],
  reports: [...reportsKey, "mensal"],
  dashboard: [...dashboardKey, "net-worth"],
  reconciliation: [...reconciliationKey, "view", null],
};
const OTHER = [...webhooksKey, "lista"];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  for (const key of [...Object.values(KEYS), OTHER]) client.setQueryData(key, { seeded: true });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const stale = (key: unknown[]) => client.getQueryState(key)?.isInvalidated === true;
  return { wrapper, stale };
}

it("manda o pedido e devolve o resultado", async () => {
  let received: unknown = null;
  server.use(
    http.post("*/api/v1/transactions/bulk", async ({ request }) => {
      received = await request.json();
      return HttpResponse.json({ affected: 2, created_ids: [] });
    }),
  );
  const { wrapper } = setup();
  const { result } = renderHook(() => useBulkTransactions(), { wrapper });
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.mutateAsync({ ids: ["a", "b"], action: "delete" });
  });
  expect(received).toEqual({ ids: ["a", "b"], action: "delete" });
  expect(outcome).toEqual({ affected: 2, created_ids: [] });
});

it("marca como desatualizado tudo que um lancamento muda, inclusive a conciliacao", async () => {
  server.use(http.post("*/api/v1/transactions/bulk", () => HttpResponse.json({ affected: 1, created_ids: [] })));
  const { wrapper, stale } = setup();
  const { result } = renderHook(() => useBulkTransactions(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ ids: ["a"], action: "duplicate" });
  });
  for (const [name, key] of Object.entries(KEYS)) expect(stale(key), name).toBe(true);
  expect(stale(OTHER)).toBe(false);
});

it("uma acao recusada nao desatualiza nada", async () => {
  server.use(
    http.post("*/api/v1/transactions/bulk", () =>
      HttpResponse.json({ detail: "x", code: "transactions_locked", locked_ids: ["a"] }, { status: 409 }),
    ),
  );
  const { wrapper, stale } = setup();
  const { result } = renderHook(() => useBulkTransactions(), { wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync({ ids: ["a"], action: "delete" })).rejects.toMatchObject({
      code: "transactions_locked",
      lockedIds: ["a"],
    });
  });
  for (const key of Object.values(KEYS)) expect(stale(key)).toBe(false);
});

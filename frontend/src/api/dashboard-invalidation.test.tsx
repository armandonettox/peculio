import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { expect, it } from "vitest";

import { server } from "@/test-utils/msw";
import { useCreateAccount, useDeleteAccount, useUpdateAccount } from "./accounts";
import { useCreateBill, useDeleteBill, useUpdateBill } from "./bills";
import { dashboardKey } from "./dashboard";
import { webhooksKey } from "./query-keys";
import { useCreateRecurrence, useDeleteRecurrence, useUpdateRecurrence } from "./recurrences";
import { useCreateTransaction, useDeleteTransaction, useUpdateTransaction } from "./transactions";

// Cada mutacao de dados que o painel mostra precisa marcar o painel como desatualizado.
// O teste planta uma consulta do painel (e uma de outro assunto) e confere o que mudou.

const NET_WORTH_KEY = [...dashboardKey, "net-worth", { months: 12 }];
const UPCOMING_KEY = [...dashboardKey, "upcoming", { days: 30 }];
const OTHER_KEY = [...webhooksKey, "list"];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  for (const key of [NET_WORTH_KEY, UPCOMING_KEY, OTHER_KEY]) client.setQueryData(key, { seeded: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const stale = (key: unknown[]) => client.getQueryState(key)?.isInvalidated === true;
  return { client, wrapper, stale };
}

// Uma resposta de sucesso para qualquer rota de gravacao que o teste usa
const ok = () => HttpResponse.json({});
const gone = () => new HttpResponse(null, { status: 204 });

function routes() {
  server.use(
    http.post("*/api/v1/accounts", ok),
    http.patch("*/api/v1/accounts/:id", ok),
    http.delete("*/api/v1/accounts/:id", gone),
    http.post("*/api/v1/transactions", ok),
    http.put("*/api/v1/transactions/:id", ok),
    http.delete("*/api/v1/transactions/:id", gone),
    http.post("*/api/v1/bills", ok),
    http.patch("*/api/v1/bills/:id", ok),
    http.delete("*/api/v1/bills/:id", gone),
    http.post("*/api/v1/recurrences", ok),
    http.patch("*/api/v1/recurrences/:id", ok),
    http.delete("*/api/v1/recurrences/:id", gone),
  );
}

const ID = "11111111-1111-4111-8111-111111111111";

// O corpo nao importa: a API falsa aceita qualquer um
const body = {} as never;

const cases: { name: string; useHook: () => { mutateAsync: (input: never) => Promise<unknown> }; input: unknown }[] = [
  { name: "criar conta", useHook: useCreateAccount as never, input: body },
  { name: "editar conta", useHook: useUpdateAccount as never, input: { id: ID, body } },
  { name: "apagar conta", useHook: useDeleteAccount as never, input: ID },
  { name: "criar lancamento", useHook: useCreateTransaction as never, input: body },
  { name: "editar lancamento", useHook: useUpdateTransaction as never, input: { id: ID, body } },
  { name: "apagar lancamento", useHook: useDeleteTransaction as never, input: ID },
  { name: "criar conta a pagar", useHook: useCreateBill as never, input: body },
  { name: "editar conta a pagar", useHook: useUpdateBill as never, input: { id: ID, body } },
  { name: "apagar conta a pagar", useHook: useDeleteBill as never, input: ID },
  { name: "criar recorrente", useHook: useCreateRecurrence as never, input: body },
  { name: "editar recorrente", useHook: useUpdateRecurrence as never, input: { id: ID, body } },
  { name: "apagar recorrente", useHook: useDeleteRecurrence as never, input: ID },
];

for (const { name, useHook, input } of cases) {
  it(`${name} marca o painel inteiro como desatualizado e nao mexe no resto`, async () => {
    routes();
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useHook(), { wrapper });
    expect(stale(NET_WORTH_KEY)).toBe(false);

    await act(async () => {
      await result.current.mutateAsync(input as never);
    });

    await waitFor(() => expect(stale(NET_WORTH_KEY)).toBe(true));
    expect(stale(UPCOMING_KEY)).toBe(true);
    expect(stale(OTHER_KEY)).toBe(false);
  });
}

it("se a gravacao falha, o painel continua como estava", async () => {
  server.use(http.post("*/api/v1/transactions", () => HttpResponse.json({ detail: "erro" }, { status: 500 })));
  const { wrapper, stale } = setup();
  const { result } = renderHook(() => useCreateTransaction(), { wrapper });

  await act(async () => {
    await result.current.mutateAsync(body).catch(() => undefined);
  });

  expect(stale(NET_WORTH_KEY)).toBe(false);
  expect(stale(UPCOMING_KEY)).toBe(false);
});

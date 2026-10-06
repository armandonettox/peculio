import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it } from "vitest";

import { server } from "@/test-utils/msw";
import { fakeSessionsApi, makeSession } from "@/test-utils/sessions-api";
import { useSessions } from "./sessions";

// O app guarda os dados 30 s por padrao (lib/query-client). A lista de aparelhos nao pode: um aparelho pode ter entrado
// ou sido encerrado ha segundos, e quem abre a pagina quer ver o que ha agora.
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const api = fakeSessionsApi([makeSession({ current: true })]);
  server.use(...api.handlers);
  const gets = () => api.state.requests.filter((request) => request.method === "GET").length;
  return { wrapper, gets };
}

it("abrir a pagina de novo busca a lista outra vez, mesmo dentro dos 30 s do padrao", async () => {
  const { wrapper, gets } = setup();
  const first = renderHook(() => useSessions(), { wrapper });
  await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
  expect(gets()).toBe(1);
  first.unmount();

  const second = renderHook(() => useSessions(), { wrapper });
  await waitFor(() => expect(gets()).toBe(2));
  await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
});

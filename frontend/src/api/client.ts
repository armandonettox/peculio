import createClient, { type Middleware } from "openapi-fetch";

import { tokenStore as defaultTokenStore, type TokenStore } from "@/auth/token-store";
import { ApiError } from "./errors";
import type { paths } from "./schema";

const REFRESH_PATH = "/api/v1/auth/refresh";
// Nessas rotas um 401 e esperado (senha errada) e nao significa sessao vencida
const NO_REFRESH_PATHS = ["/api/v1/auth/login", "/api/v1/auth/register", REFRESH_PATH];

type ApiClientOptions = {
  baseUrl?: string;
  tokenStore?: TokenStore;
};

export function createApiClient({
  baseUrl = window.location.origin,
  tokenStore = defaultTokenStore,
}: ApiClientOptions = {}) {
  // O fetch e resolvido a cada chamada, nao guardado na criacao. Assim quem troca o
  // fetch global depois (os testes, com msw) continua sendo respeitado.
  const client = createClient<paths>({ baseUrl, fetch: (request) => globalThis.fetch(request) });

  // Varios pedidos podem tomar 401 ao mesmo tempo. Todos esperam a mesma renovacao,
  // senao cada um dispararia a sua e os tokens se atropelariam.
  let refreshInFlight: Promise<boolean> | null = null;

  async function doRefresh(): Promise<boolean> {
    const current = tokenStore.get();
    if (!current) return false;
    try {
      const response = await fetch(`${baseUrl}${REFRESH_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${current}` },
      });
      if (!response.ok) {
        tokenStore.clear();
        return false;
      }
      const data = (await response.json()) as { access_token: string };
      tokenStore.set(data.access_token);
      return true;
    } catch {
      // Sem rede nao da para saber se a sessao venceu: mantem o token e tenta de novo depois
      return false;
    }
  }

  function refreshAccessToken(): Promise<boolean> {
    refreshInFlight ??= doRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  // O corpo de um Request so pode ser lido uma vez. Guardo uma copia de cada pedido para
  // poder repeti-lo depois de renovar o token.
  const copies = new Map<string, Request>();

  const middleware: Middleware = {
    onRequest({ request, id }) {
      const token = tokenStore.get();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      copies.set(id, request.clone());
      return request;
    },
    async onResponse({ request, response, id }) {
      const copy = copies.get(id);
      copies.delete(id);

      const path = new URL(request.url).pathname;
      const canRefresh = response.status === 401 && !NO_REFRESH_PATHS.includes(path) && tokenStore.get();
      if (!canRefresh || !copy) return response;

      if (!(await refreshAccessToken())) return response;

      copy.headers.set("Authorization", `Bearer ${tokenStore.get()}`);
      return fetch(copy);
    },
  };
  client.use(middleware);

  return { client, refreshAccessToken };
}

// Chamada tipada que devolve os dados ou lanca ApiError. Assim as telas usam try/catch e
// o TanStack Query recebe o erro no formato certo.
export async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result;
  try {
    result = await request;
  } catch {
    throw ApiError.network();
  }
  if (result.error !== undefined || !result.response.ok) {
    throw ApiError.fromResponse(result.response.status, result.error);
  }
  return result.data as T;
}

export const api = createApiClient();

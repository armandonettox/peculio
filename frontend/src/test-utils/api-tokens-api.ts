import { http, HttpResponse } from "msw";

import type { ApiToken } from "@/api/api-tokens";

let counter = 0;

/** Token de lista (sem o valor completo). Por padrao: so leitura, nunca expira e nunca usado. */
export function makeApiToken(overrides: Partial<ApiToken> = {}): ApiToken {
  counter += 1;
  return {
    id: `70000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Token ${counter}`,
    prefix: `fin_tk${String(counter).padStart(6, "0")}`,
    scope: "read",
    expires_at: null,
    last_used_at: null,
    created_at: "2026-03-01T12:00:00Z",
    expired: false,
    ...overrides,
  };
}

type NextError = { status: number; code: string; detail?: string };
type Recorded = { method: string; path: string; body?: Record<string, unknown> };

/**
 * API de tokens de mentira, com estado. Criar devolve o valor completo uma unica vez (guardado em `values`
 * para o teste conferir que a lista nunca o mostra); recusa nome repetido e o 11o token, como o backend.
 */
export function fakeApiTokensApi(initial: ApiToken[] = []) {
  const state = {
    tokens: [...initial],
    requests: [] as Recorded[],
    values: {} as Record<string, string>,
    listError: false,
    nextCreateError: null as NextError | null,
    nextRevokeError: null as NextError | null,
    // Segura a resposta da criacao ate o teste chamar release()
    holdCreate: false,
    release: null as (() => void) | null,
  };

  const fail = (error: NextError) =>
    HttpResponse.json({ detail: error.detail ?? "erro", code: error.code }, { status: error.status });

  const handlers = [
    http.get("*/api/v1/api-tokens", ({ request }) => {
      state.requests.push({ method: "GET", path: "/api-tokens" });
      void request;
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const items = [...state.tokens].reverse();
      return HttpResponse.json({ items, total: items.length, limit: 50, offset: 0 });
    }),

    http.post("*/api/v1/api-tokens", async ({ request }) => {
      const body = (await request.json()) as { name: string; scope: ApiToken["scope"]; expires_in_days?: number | null };
      state.requests.push({ method: "POST", path: "/api-tokens", body: body as unknown as Record<string, unknown> });
      if (state.holdCreate) await new Promise<void>((resolve) => (state.release = resolve));
      const error = state.nextCreateError;
      state.nextCreateError = null;
      if (error) return fail(error);
      if (state.tokens.some((token) => token.name.toLowerCase() === body.name.toLowerCase())) {
        return fail({ status: 409, code: "api_token_name_taken" });
      }
      if (state.tokens.length >= 10) return fail({ status: 409, code: "api_token_limit_reached" });
      const value = `fin_${String(counter + 1).padStart(8, "0")}${"z".repeat(35)}`;
      const created = makeApiToken({
        name: body.name,
        scope: body.scope,
        prefix: value.slice(0, 12),
        expires_at:
          body.expires_in_days == null ? null : new Date(Date.now() + body.expires_in_days * 86_400_000).toISOString(),
      });
      state.tokens.push(created);
      state.values[created.id] = value;
      return HttpResponse.json({ ...created, token: value }, { status: 201 });
    }),

    http.delete("*/api/v1/api-tokens/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", path: `/api-tokens/${params.id}` });
      const error = state.nextRevokeError;
      state.nextRevokeError = null;
      if (error) return fail(error);
      state.tokens = state.tokens.filter((token) => token.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const mutations = () => state.requests.filter((request) => request.method !== "GET");
  return { handlers, state, mutations };
}

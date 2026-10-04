import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { apiTokensKey } from "./query-keys";
import type { components } from "./schema";

export type ApiToken = components["schemas"]["ApiTokenOut"];
export type ApiTokenCreate = components["schemas"]["ApiTokenCreate"];
export type ApiTokenCreated = components["schemas"]["ApiTokenCreated"];
export type ApiTokenScope = ApiToken["scope"];

export { apiTokensKey };

// O servidor aceita no maximo 10 tokens por pessoa; a lista cabe numa pagina so
const PAGE_LIMIT = 50;
export const MAX_API_TOKENS = 10;

export function useApiTokens() {
  return useQuery({
    queryKey: [...apiTokensKey, "list"],
    queryFn: async () => {
      const page = await unwrap(api.client.GET("/api/v1/api-tokens", { params: { query: { limit: PAGE_LIMIT } } }));
      return page.items;
    },
  });
}

// O valor completo so existe na resposta da criacao; a lista recarrega para mostrar o token novo
export function useCreateApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApiTokenCreate) => unwrap(api.client.POST("/api/v1/api-tokens", { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiTokensKey }),
  });
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/api-tokens/{token_id}", { params: { path: { token_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiTokensKey }),
  });
}

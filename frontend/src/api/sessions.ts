import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import type { components } from "./schema";

export type AuthSession = components["schemas"]["SessionOut"];

export const sessionsKey = ["auth-sessions"] as const;

/** Os aparelhos conectados desta conta (so a tela, nunca token de API). */
export function useSessions() {
  return useQuery({
    queryKey: sessionsKey,
    // Sempre atual ao abrir a pagina: um aparelho pode ter entrado ou sido encerrado ha segundos (o padrao guarda 30 s)
    staleTime: 0,
    queryFn: () => unwrap(api.client.GET("/api/v1/auth/sessions")),
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: sessionsKey });
}

/** Encerra um aparelho: o token e o cookie dele deixam de valer na hora. */
export function useRevokeSession() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/auth/sessions/{session_id}", { params: { path: { session_id: id } } })),
    onSuccess: refresh,
  });
}

/** Encerra todos os aparelhos, menos este. Devolve quantos encerrou. */
export function useRevokeOtherSessions() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => unwrap(api.client.DELETE("/api/v1/auth/sessions")),
    onSuccess: refresh,
  });
}

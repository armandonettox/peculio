import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import type { components } from "./schema";

export type Invite = components["schemas"]["InviteOut"];
export type InviteCreated = components["schemas"]["InviteCreated"];

export const invitesKey = ["invites"] as const;

// A lista de convites cabe numa pagina so (um convite por pessoa nova)
const PAGE_LIMIT = 100;

export function useInvites({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...invitesKey, "list"],
    enabled,
    queryFn: async () => (await unwrap(api.client.GET("/api/v1/invites", { params: { query: { limit: PAGE_LIMIT } } }))).items,
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: invitesKey });
}

/** Cria o convite. O codigo (`token`) so vem nesta resposta: depois so existe o hash no servidor. */
export function useCreateInvite() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (email: string) => unwrap(api.client.POST("/api/v1/invites", { body: { email } })),
    onSuccess: refresh,
  });
}

export function useRevokeInvite() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/invites/{invite_id}", { params: { path: { invite_id: id } } })),
    onSuccess: refresh,
  });
}

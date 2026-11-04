import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { invitesKey } from "./invites";

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      unwrap(api.client.DELETE("/api/v1/users/{user_id}", { params: { path: { user_id: userId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitesKey }),
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import type { components } from "./schema";

export type SecurityContact = components["schemas"]["SecurityContactOut"];

export const securityContactKey = ["instance", "security-contact"] as const;

/** O contato de seguranca da instalacao (qualquer pessoa logada le). */
export function useSecurityContact() {
  return useQuery({
    queryKey: securityContactKey,
    queryFn: () => unwrap(api.client.GET("/api/v1/instance/security-contact")),
  });
}

/** Salva o contato (so administrador). Contato vazio apaga. */
export function useUpdateSecurityContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contact: string | null) =>
      unwrap(api.client.PUT("/api/v1/instance/security-contact", { body: { contact } })),
    onSuccess: (saved) => queryClient.setQueryData(securityContactKey, saved),
  });
}

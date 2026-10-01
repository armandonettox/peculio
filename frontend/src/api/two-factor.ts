import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import type { components } from "./schema";

export type TwoFactorStatus = components["schemas"]["TwoFactorStatus"];
export type TwoFactorSetup = components["schemas"]["TwoFactorSetupOut"];
export type TwoFactorConfirm = components["schemas"]["TwoFactorConfirm"];

export const twoFactorKey = ["two-factor"] as const;

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: twoFactorKey,
    queryFn: () => unwrap(api.client.GET("/api/v1/auth/2fa/status")),
  });
}

function useRefreshStatus() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: twoFactorKey });
}

/** Gera um segredo novo (ainda inativo) para mostrar no QR code. */
export function useSetupTwoFactor() {
  return useMutation({
    mutationFn: () => unwrap(api.client.POST("/api/v1/auth/2fa/setup")),
  });
}

/** Confirma o segredo com um codigo do app e ativa. Devolve os codigos de recuperacao. */
export function useEnableTwoFactor() {
  const refresh = useRefreshStatus();
  return useMutation({
    mutationFn: (code: string) => unwrap(api.client.POST("/api/v1/auth/2fa/enable", { body: { code } })),
    onSuccess: refresh,
  });
}

export function useDisableTwoFactor() {
  const refresh = useRefreshStatus();
  return useMutation({
    mutationFn: (body: TwoFactorConfirm) => unwrap(api.client.POST("/api/v1/auth/2fa/disable", { body })),
    onSuccess: refresh,
  });
}

export function useRegenerateRecoveryCodes() {
  const refresh = useRefreshStatus();
  return useMutation({
    mutationFn: (body: TwoFactorConfirm) => unwrap(api.client.POST("/api/v1/auth/2fa/recovery-codes", { body })),
    onSuccess: refresh,
  });
}

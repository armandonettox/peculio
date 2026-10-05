import { useMutation } from "@tanstack/react-query";

import { useAuth } from "@/auth/auth-context";
import { tokenStore } from "@/auth/token-store";
import { api, unwrap } from "./client";
import type { components } from "./schema";

// O perfil e a senha da propria conta. Trocar a senha invalida o token de agora; a sessao desta aba continua com o que
// vem na resposta.
export type ProfileUpdate = components["schemas"]["ProfileUpdate"];
export type PasswordChange = components["schemas"]["PasswordChange"];

/** Salva nome e/ou moeda padrao e ja troca o usuario mostrado no app (o nome do menu, por exemplo). */
export function useUpdateProfile() {
  const { updateUser } = useAuth();
  return useMutation({
    mutationFn: (body: ProfileUpdate) => unwrap(api.client.PATCH("/api/v1/auth/me", { body })),
    onSuccess: (user) => updateUser(user),
  });
}

/** Troca a senha. O token novo entra no lugar do velho para esta aba nao ser desconectada. */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (body: PasswordChange) => {
      const token = await unwrap(api.client.POST("/api/v1/auth/password", { body }));
      tokenStore.set(token.access_token);
    },
  });
}

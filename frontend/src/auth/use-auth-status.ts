import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/api/client";

// Diz se a instancia ainda nao tem nenhum usuario (primeiro acesso)
export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth-status"],
    queryFn: () => unwrap(api.client.GET("/api/v1/auth/status")),
    // Sempre confere de novo: o status muda assim que o primeiro usuario e criado
    staleTime: 0,
  });
}

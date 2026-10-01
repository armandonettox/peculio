import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/api/errors";

const MAX_RETRIES = 2;

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Erro 4xx (permissao, nao encontrado, dados invalidos) nao melhora tentando de novo.
        // So vale repetir quando foi falha de rede ou do servidor.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < MAX_RETRIES;
        },
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();

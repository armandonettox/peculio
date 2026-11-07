import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { favoritesKey } from "./query-keys";
import type { components } from "./schema";

export type Favorite = components["schemas"]["FavoriteOut"];
export type FavoriteIn = components["schemas"]["FavoriteIn"];
export type Suggestion = components["schemas"]["SuggestionOut"];
// Favorito e so de saida ou entrada (transferencia nao tem)
export type FavoriteType = FavoriteIn["type"];

export { favoritesKey };

/** Todos os favoritos de um sentido, para o coracao saber se a descricao digitada ja e favorita. */
export function useFavorites(type: FavoriteType) {
  return useQuery({
    queryKey: [...favoritesKey, "list", type],
    queryFn: () => unwrap(api.client.GET("/api/v1/favorites", { params: { query: { type } } })),
  });
}

/** Sugestoes para a descricao: favoritos primeiro, depois o que ja foi lancado. Sem valor. */
export function useSuggestions(type: FavoriteType, search: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...favoritesKey, "suggestions", type, search],
    enabled,
    queryFn: () => unwrap(api.client.GET("/api/v1/favorites/suggestions", { params: { query: { type, q: search } } })),
  });
}

export function useSaveFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: FavoriteIn) => unwrap(api.client.POST("/api/v1/favorites", { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: favoritesKey }),
  });
}

export function useDeleteFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/favorites/{favorite_id}", { params: { path: { favorite_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: favoritesKey }),
  });
}

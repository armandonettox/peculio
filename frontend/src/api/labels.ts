import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import type { components } from "./schema";

export type Category = components["schemas"]["CategoryOut"];
export type CategoryCreate = components["schemas"]["CategoryCreate"];
export type CategoryUpdate = components["schemas"]["CategoryUpdate"];
export type Tag = components["schemas"]["TagOut"];
export type TagCreate = components["schemas"]["TagCreate"];
export type TagUpdate = components["schemas"]["TagUpdate"];

export const categoriesKey = ["categories"] as const;
export const tagsKey = ["tags"] as const;

// Quem tem mais de 200 e raro; a tela busca tudo de uma vez (o maximo da API)
const PAGE_LIMIT = 200;

// ---------- Categorias ----------

export type CategoryKind = NonNullable<Category["kind"]>;

export function useCategories({ search, kind }: { search: string; kind?: CategoryKind }) {
  return useQuery({
    queryKey: [...categoriesKey, { search, kind }],
    queryFn: async () => {
      const query = {
        limit: PAGE_LIMIT,
        ...(search ? { q: search } : {}),
        ...(kind ? { kind } : {}),
      };
      return unwrap(api.client.GET("/api/v1/categories", { params: { query } }));
    },
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CategoryCreate) => unwrap(api.client.POST("/api/v1/categories", { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: categoriesKey }),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CategoryUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/categories/{category_id}", { params: { path: { category_id: id } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: categoriesKey }),
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/categories/{category_id}", { params: { path: { category_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: categoriesKey }),
  });
}

// ---------- Tags ----------

export function useTags({ search }: { search: string }) {
  return useQuery({
    queryKey: [...tagsKey, { search }],
    queryFn: async () => {
      const query = search ? { limit: PAGE_LIMIT, q: search } : { limit: PAGE_LIMIT };
      return unwrap(api.client.GET("/api/v1/tags", { params: { query } }));
    },
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TagCreate) => unwrap(api.client.POST("/api/v1/tags", { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tagsKey }),
  });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TagUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/tags/{tag_id}", { params: { path: { tag_id: id } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tagsKey }),
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/tags/{tag_id}", { params: { path: { tag_id: id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tagsKey }),
  });
}

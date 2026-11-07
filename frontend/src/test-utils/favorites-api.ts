import { http, HttpResponse } from "msw";

import type { Favorite, Suggestion } from "@/api/favorites";

let counter = 0;

export function makeFavorite(overrides: Partial<Favorite> = {}): Favorite {
  counter += 1;
  return {
    id: `f0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    type: "withdrawal",
    description: `Favorito ${counter}`,
    category_id: null,
    account_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * API de favoritos de mentira, com estado. `history` e o que "ja foi lancado" (so descricao, categoria e conta).
 * Como o backend: o mesmo texto (ignorando maiuscula) no mesmo sentido atualiza o favorito em vez de repetir, e as
 * sugestoes trazem os favoritos primeiro e depois o historico, sem repetir.
 */
export function fakeFavoritesApi(initial: Favorite[] = [], history: Omit<Suggestion, "favorite_id">[] = []) {
  const state = {
    items: [...initial],
    saves: [] as Record<string, unknown>[],
    deleted: [] as string[],
    suggestionQueries: [] as { type: string; q: string }[],
  };

  const handlers = [
    http.get("*/api/v1/favorites/suggestions", ({ request }) => {
      const url = new URL(request.url);
      const type = url.searchParams.get("type") ?? "withdrawal";
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      state.suggestionQueries.push({ type, q });
      const favorites = state.items
        .filter((item) => item.type === type && item.description.toLowerCase().includes(q))
        .map((item) => ({
          description: item.description,
          category_id: item.category_id,
          account_id: item.account_id,
          favorite_id: item.id,
        }));
      const taken = new Set(favorites.map((item) => item.description.toLowerCase()));
      const past = history
        .filter((item) => item.description.toLowerCase().includes(q) && !taken.has(item.description.toLowerCase()))
        .map((item) => ({ ...item, favorite_id: null }));
      return HttpResponse.json([...favorites, ...past]);
    }),
    http.get("*/api/v1/favorites", ({ request }) => {
      const type = new URL(request.url).searchParams.get("type");
      return HttpResponse.json(state.items.filter((item) => !type || item.type === type));
    }),
    http.post("*/api/v1/favorites", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.saves.push(body);
      const existing = state.items.find(
        (item) => item.type === body.type && item.description.toLowerCase() === String(body.description).toLowerCase(),
      );
      if (existing) {
        existing.category_id = (body.category_id as string | null) ?? null;
        existing.account_id = (body.account_id as string | null) ?? null;
        return HttpResponse.json(existing, { status: 200 });
      }
      const created = makeFavorite({
        type: body.type as Favorite["type"],
        description: String(body.description),
        category_id: (body.category_id as string | null) ?? null,
        account_id: (body.account_id as string | null) ?? null,
      });
      state.items.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.delete("*/api/v1/favorites/:id", ({ params }) => {
      state.deleted.push(String(params.id));
      state.items = state.items.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return { handlers, state };
}

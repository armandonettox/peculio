import { http, HttpResponse } from "msw";

export type FakeLabel = { id: string; name: string; color?: string | null; created_at: string };

let counter = 0;

export function makeLabel(overrides: Partial<FakeLabel> = {}): FakeLabel {
  counter += 1;
  return {
    id: `10000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Item ${counter}`,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

type NextError = { status: number; code: string; errors?: { field: string; message: string }[] };
type Recorded = { method: string; path: string; body?: Record<string, unknown>; query?: URLSearchParams };

/**
 * API de categorias ou tags de mentira, com estado. Como o backend, recusa nome repetido
 * sem diferenciar maiuscula de minuscula e filtra a busca por parte do nome.
 */
export function fakeLabelsApi(resource: "categories" | "tags", initial: FakeLabel[] = []) {
  const takenCode = resource === "categories" ? "category_name_taken" : "tag_name_taken";
  const withColor = resource === "categories";
  const state = {
    items: [...initial],
    requests: [] as Recorded[],
    nextMutationError: null as NextError | null,
    listError: false,
  };

  const fail = (error: NextError) =>
    HttpResponse.json(
      { detail: "erro", code: error.code, ...(error.errors ? { errors: error.errors } : {}) },
      { status: error.status },
    );
  const takeError = () => {
    const error = state.nextMutationError;
    state.nextMutationError = null;
    return error;
  };
  const taken = (name: string, ignoreId?: string) =>
    state.items.some((item) => item.id !== ignoreId && item.name.toLowerCase() === name.trim().toLowerCase());

  const base = `*/api/v1/${resource}`;
  const handlers = [
    http.get(base, ({ request }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: `/${resource}`, query });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const q = (query.get("q") ?? "").toLowerCase();
      const items = state.items
        .filter((item) => item.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 });
    }),

    http.post(base, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "POST", path: `/${resource}`, body });
      const error = takeError();
      if (error) return fail(error);
      if (taken(String(body.name))) return fail({ status: 409, code: takenCode });
      const created = makeLabel({
        name: String(body.name).trim(),
        ...(withColor ? { color: (body.color as string | undefined)?.toUpperCase() ?? null } : {}),
      });
      state.items.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),

    http.patch(`${base}/:id`, async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "PATCH", path: `/${resource}/${params.id}`, body });
      const error = takeError();
      if (error) return fail(error);
      const item = state.items.find((i) => i.id === params.id);
      if (!item) return fail({ status: 404, code: `${resource === "categories" ? "category" : "tag"}_not_found` });
      if (typeof body.name === "string" && taken(body.name, item.id)) return fail({ status: 409, code: takenCode });
      if (typeof body.name === "string") item.name = body.name.trim();
      if ("color" in body) item.color = (body.color as string | null)?.toUpperCase() ?? null;
      return HttpResponse.json(item);
    }),

    http.delete(`${base}/:id`, ({ params }) => {
      state.requests.push({ method: "DELETE", path: `/${resource}/${params.id}` });
      const error = takeError();
      if (error) return fail(error);
      state.items = state.items.filter((i) => i.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  const mutations = () => state.requests.filter((r) => r.method !== "GET");
  const lastSearch = () => state.requests.filter((r) => r.method === "GET").at(-1)?.query?.get("q") ?? null;
  return { handlers, state, mutations, lastSearch };
}

import { http, HttpResponse } from "msw";

import type { Webhook, WebhookDelivery } from "@/api/webhooks";

let counter = 0;

export function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  counter += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    name: `Webhook ${counter}`,
    url: `https://hooks.example.com/${counter}`,
    events: ["transaction.created"],
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    last_delivery_status: null,
    last_delivery_at: null,
    ...overrides,
  };
}

export function makeDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  counter += 1;
  return {
    id: `f0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    webhook_id: "e0000000-0000-4000-8000-000000000000",
    event: "transaction.created",
    status: "delivered",
    attempts: 1,
    next_attempt_at: null,
    last_attempt_at: "2026-03-15T12:00:00Z",
    last_status_code: 200,
    last_error: null,
    response_excerpt: null,
    created_at: "2026-03-15T12:00:00Z",
    delivered_at: "2026-03-15T12:00:00Z",
    ...overrides,
  };
}

type NextError = { status: number; code: string; errors?: { field: string; message: string }[] };
type Recorded = { method: string; path: string; body?: Record<string, unknown>; query?: URLSearchParams };

export const FAKE_SECRET = "segredo-de-teste-0123456789abcdef0123456789";

/**
 * API de webhooks de mentira, com estado. Recusa nome repetido sem diferenciar maiuscula de minuscula,
 * devolve o segredo so na criacao e na rotacao, como o backend. O resultado do teste e o que o teste
 * escrever em `state.testResult`.
 */
export function fakeWebhooksApi(initial: Webhook[] = [], deliveries: Record<string, WebhookDelivery[]> = {}) {
  const state = {
    webhooks: [...initial],
    deliveries: { ...deliveries },
    requests: [] as Recorded[],
    nextMutationError: null as NextError | null,
    listError: false,
    deliveriesError: false,
    testResult: {} as Partial<WebhookDelivery>,
    testDelayMs: 0,
    mutationDelayMs: 0,
    secretCounter: 0,
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
    state.webhooks.some((item) => item.id !== ignoreId && item.name.toLowerCase() === name.trim().toLowerCase());
  const nextSecret = () => {
    state.secretCounter += 1;
    return `${FAKE_SECRET}-${state.secretCounter}`;
  };

  const handlers = [
    http.get("*/api/v1/webhooks", ({ request }) => {
      state.requests.push({ method: "GET", path: "/webhooks", query: new URL(request.url).searchParams });
      if (state.listError) return fail({ status: 500, code: "internal_error" });
      const items = [...state.webhooks].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return HttpResponse.json({ items, total: items.length, limit: 200, offset: 0 });
    }),

    http.post("*/api/v1/webhooks", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "POST", path: "/webhooks", body });
      if (state.mutationDelayMs) await new Promise((resolve) => setTimeout(resolve, state.mutationDelayMs));
      const error = takeError();
      if (error) return fail(error);
      if (taken(String(body.name))) return fail({ status: 409, code: "webhook_name_taken" });
      const created = makeWebhook({
        name: String(body.name),
        url: String(body.url),
        events: body.events as Webhook["events"],
        active: body.active !== false,
      });
      state.webhooks.push(created);
      return HttpResponse.json({ ...created, secret: nextSecret() }, { status: 201 });
    }),

    http.patch("*/api/v1/webhooks/:id", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      state.requests.push({ method: "PATCH", path: `/webhooks/${params.id}`, body });
      const error = takeError();
      if (error) return fail(error);
      const index = state.webhooks.findIndex((item) => item.id === params.id);
      if (index < 0) return fail({ status: 404, code: "webhook_not_found" });
      if (typeof body.name === "string" && taken(body.name, String(params.id))) {
        return fail({ status: 409, code: "webhook_name_taken" });
      }
      state.webhooks[index] = { ...state.webhooks[index], ...body } as Webhook;
      return HttpResponse.json(state.webhooks[index]);
    }),

    http.delete("*/api/v1/webhooks/:id", ({ params }) => {
      state.requests.push({ method: "DELETE", path: `/webhooks/${params.id}` });
      const error = takeError();
      if (error) return fail(error);
      state.webhooks = state.webhooks.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),

    http.post("*/api/v1/webhooks/:id/rotate-secret", ({ params }) => {
      state.requests.push({ method: "POST", path: `/webhooks/${params.id}/rotate-secret` });
      const error = takeError();
      if (error) return fail(error);
      const found = state.webhooks.find((item) => item.id === params.id);
      if (!found) return fail({ status: 404, code: "webhook_not_found" });
      return HttpResponse.json({ ...found, secret: nextSecret() });
    }),

    http.post("*/api/v1/webhooks/:id/test", async ({ params }) => {
      state.requests.push({ method: "POST", path: `/webhooks/${params.id}/test` });
      const error = takeError();
      if (error) return fail(error);
      if (state.testDelayMs) await new Promise((resolve) => setTimeout(resolve, state.testDelayMs));
      return HttpResponse.json(
        makeDelivery({ webhook_id: String(params.id), event: "webhook.test", ...state.testResult }),
      );
    }),

    http.get("*/api/v1/webhooks/:id/deliveries", ({ request, params }) => {
      const query = new URL(request.url).searchParams;
      state.requests.push({ method: "GET", path: `/webhooks/${params.id}/deliveries`, query });
      if (state.deliveriesError) return fail({ status: 500, code: "internal_error" });
      const status = query.get("status");
      const limit = Number(query.get("limit") ?? 50);
      const offset = Number(query.get("offset") ?? 0);
      const all = (state.deliveries[String(params.id)] ?? []).filter((item) => !status || item.status === status);
      return HttpResponse.json({ items: all.slice(offset, offset + limit), total: all.length, limit, offset });
    }),
  ];

  const mutations = () => state.requests.filter((request) => request.method !== "GET");
  const deliveryRequests = () => state.requests.filter((request) => request.path.endsWith("/deliveries"));
  return { handlers, state, mutations, deliveryRequests };
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { webhooksKey } from "./query-keys";
import type { components } from "./schema";

export type Webhook = components["schemas"]["WebhookOut"];
export type WebhookWithSecret = components["schemas"]["WebhookWithSecretOut"];
export type WebhookCreate = components["schemas"]["WebhookCreate"];
export type WebhookUpdate = components["schemas"]["WebhookUpdate"];
export type WebhookDelivery = components["schemas"]["DeliveryOut"];
export type DeliveryStatus = components["schemas"]["DeliveryStatus"];
export type WebhookEventName = WebhookCreate["events"][number];

export { webhooksKey };

// O maximo por pessoa e 20, entao a tela busca tudo de uma vez
const PAGE_LIMIT = 200;
export const DELIVERIES_PAGE_SIZE = 10;

export function useWebhooks() {
  return useQuery({
    queryKey: [...webhooksKey, "list"],
    queryFn: async () => {
      const page = await unwrap(api.client.GET("/api/v1/webhooks", { params: { query: { limit: PAGE_LIMIT } } }));
      return page.items;
    },
  });
}

/** Historico de entregas de um webhook, das mais recentes para as mais antigas. */
export function useDeliveries({
  webhookId,
  status,
  page,
}: {
  webhookId: string;
  status: DeliveryStatus | "all";
  page: number;
}) {
  return useQuery({
    queryKey: [...webhooksKey, "deliveries", webhookId, { status, page }],
    queryFn: () =>
      unwrap(
        api.client.GET("/api/v1/webhooks/{webhook_id}/deliveries", {
          params: {
            path: { webhook_id: webhookId },
            query: {
              limit: DELIVERIES_PAGE_SIZE,
              offset: page * DELIVERIES_PAGE_SIZE,
              ...(status === "all" ? {} : { status }),
            },
          },
        }),
      ),
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: webhooksKey });
}

export function useCreateWebhook() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: WebhookCreate) => unwrap(api.client.POST("/api/v1/webhooks", { body })),
    onSuccess: refresh,
  });
}

export function useUpdateWebhook() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: WebhookUpdate }) =>
      unwrap(api.client.PATCH("/api/v1/webhooks/{webhook_id}", { params: { path: { webhook_id: id } }, body })),
    onSuccess: refresh,
  });
}

export function useDeleteWebhook() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.DELETE("/api/v1/webhooks/{webhook_id}", { params: { path: { webhook_id: id } } })),
    onSuccess: refresh,
  });
}

export function useRotateWebhookSecret() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.POST("/api/v1/webhooks/{webhook_id}/rotate-secret", { params: { path: { webhook_id: id } } })),
    onSuccess: refresh,
  });
}

/** Envia o evento de teste agora e devolve o resultado da entrega. */
export function useTestWebhook() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.client.POST("/api/v1/webhooks/{webhook_id}/test", { params: { path: { webhook_id: id } } })),
    // O teste vira a ultima entrega do cartao e entra no historico
    onSettled: refresh,
  });
}

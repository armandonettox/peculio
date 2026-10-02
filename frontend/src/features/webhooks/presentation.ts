import type { DeliveryStatus, WebhookDelivery, WebhookEventName } from "@/api/webhooks";

export const EVENTS: WebhookEventName[] = ["transaction.created", "transaction.updated", "transaction.deleted"];

export const EVENT_LABELS: Record<WebhookEventName | WebhookDelivery["event"], string> = {
  "transaction.created": "Lançamento criado",
  "transaction.updated": "Lançamento editado",
  "transaction.deleted": "Lançamento excluído",
  "webhook.test": "Teste",
};

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  delivered: "Entregue",
  pending: "Pendente",
  failed: "Falhou",
  expired: "Expirada",
};

/** "02/10/2026 14:30" no fuso de quem esta olhando. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Linha de resumo da ultima entrega no cartao. */
export function lastDeliveryText(status: DeliveryStatus | null | undefined, at: string | null | undefined): string {
  if (!status || !at) return "Nenhuma entrega ainda";
  return `Última entrega: ${STATUS_LABELS[status]} em ${formatDateTime(at)}`;
}

/** Resumo de uma tentativa para o historico: "HTTP 500", "sem resposta" ou nada se ainda nao houve. */
export function httpText(delivery: Pick<WebhookDelivery, "attempts" | "last_status_code">): string {
  if (delivery.attempts === 0) return "Ainda não tentada";
  return delivery.last_status_code ? `HTTP ${delivery.last_status_code}` : "Sem resposta";
}

import { currentIntlLocale, i18n } from "@/i18n";
import type { DeliveryStatus, WebhookDelivery, WebhookEventName } from "@/api/webhooks";

export const EVENTS: WebhookEventName[] = ["transaction.created", "transaction.updated", "transaction.deleted"];

export function eventLabel(event: WebhookEventName | WebhookDelivery["event"]): string {
  switch (event) {
    case "transaction.created":
      return i18n.t("webhooks.presentation.event.transactionCreated");
    case "transaction.updated":
      return i18n.t("webhooks.presentation.event.transactionUpdated");
    case "transaction.deleted":
      return i18n.t("webhooks.presentation.event.transactionDeleted");
    case "webhook.test":
      return i18n.t("webhooks.presentation.event.webhookTest");
  }
}

export function statusLabel(status: DeliveryStatus): string {
  return i18n.t(`webhooks.presentation.status.${status}`);
}

/** "02/10/2026 14:30" no fuso de quem esta olhando. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(currentIntlLocale(), { dateStyle: "short", timeStyle: "short" });
}

/** Linha de resumo da ultima entrega no cartao. */
export function lastDeliveryText(status: DeliveryStatus | null | undefined, at: string | null | undefined): string {
  if (!status || !at) return i18n.t("webhooks.presentation.nenhumaEntregaAinda");
  return i18n.t("webhooks.presentation.ultimaEntrega", { status: statusLabel(status), date: formatDateTime(at) });
}

/** Resumo de uma tentativa para o historico: "HTTP 500", "sem resposta" ou nada se ainda nao houve. */
export function httpText(delivery: Pick<WebhookDelivery, "attempts" | "last_status_code">): string {
  if (delivery.attempts === 0) return i18n.t("webhooks.presentation.aindaNaoTentada");
  return delivery.last_status_code
    ? i18n.t("webhooks.presentation.httpCode", { code: delivery.last_status_code })
    : i18n.t("webhooks.presentation.semResposta");
}

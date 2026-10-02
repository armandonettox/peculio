import { History, KeyRound, MoreVertical, Pause, Pencil, Play, Send, Trash2 } from "lucide-react";

import type { Webhook } from "@/api/webhooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { maskWebhookUrl } from "./mask-url";
import { EVENT_LABELS, lastDeliveryText } from "./presentation";

type Props = {
  webhook: Webhook;
  onEdit: (webhook: Webhook) => void;
  onTest: (webhook: Webhook) => void;
  onRotateSecret: (webhook: Webhook) => void;
  onHistory: (webhook: Webhook) => void;
  onTogglePause: (webhook: Webhook) => void;
  onDelete: (webhook: Webhook) => void;
};

const LAST_STATUS_STYLE = {
  delivered: "text-positive",
  pending: "text-muted-foreground",
  failed: "text-destructive",
  expired: "text-muted-foreground",
} as const;

export function WebhookCard({ webhook, onEdit, onTest, onRotateSecret, onHistory, onTogglePause, onDelete }: Props) {
  // O token costuma ir na query: na lista ele fica escondido. O valor real so aparece ao editar.
  const maskedUrl = maskWebhookUrl(webhook.url);
  return (
    <li className={cn("rounded-lg border bg-card p-4 text-card-foreground shadow-sm", !webhook.active && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{webhook.name}</h3>
            {!webhook.active && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Pausado</span>
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground" title={maskedUrl}>
            {maskedUrl}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Ações do webhook ${webhook.name}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onSelect={() => onTest(webhook)}>
              <Send />
              Testar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onHistory(webhook)}>
              <History />
              Histórico de entregas
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEdit(webhook)}>
              <Pencil />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRotateSecret(webhook)}>
              <KeyRound />
              Girar segredo
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onTogglePause(webhook)}>
              {webhook.active ? <Pause /> : <Play />}
              {webhook.active ? "Pausar" : "Retomar"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(webhook)} className="text-destructive">
              <Trash2 />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ul aria-label="Eventos" className="mt-3 flex flex-wrap gap-1.5">
        {webhook.events.map((event) => (
          <li key={event} className="rounded-md bg-accent px-2 py-0.5 text-xs text-primary-text">
            {EVENT_LABELS[event]}
          </li>
        ))}
      </ul>

      <p
        className={cn(
          "mt-3 text-sm font-medium",
          webhook.last_delivery_status ? LAST_STATUS_STYLE[webhook.last_delivery_status] : "text-muted-foreground",
        )}
      >
        {lastDeliveryText(webhook.last_delivery_status, webhook.last_delivery_at)}
      </p>
    </li>
  );
}

import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { DELIVERIES_PAGE_SIZE, useDeliveries, type DeliveryStatus, type Webhook } from "@/api/webhooks";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EVENT_LABELS, formatDateTime, httpText, STATUS_LABELS } from "./presentation";

type Props = {
  webhook: Webhook;
  onClose: () => void;
};

const STATUS_STYLE: Record<DeliveryStatus, string> = {
  delivered: "text-positive",
  pending: "text-muted-foreground",
  failed: "text-destructive",
  expired: "text-muted-foreground",
};

export function DeliveriesDialog({ webhook, onClose }: Props) {
  const [status, setStatus] = useState<DeliveryStatus | "all">("all");
  const [page, setPage] = useState(0);
  const query = useDeliveries({ webhookId: webhook.id, status, page });
  const total = query.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / DELIVERIES_PAGE_SIZE) - 1);

  let content;
  if (query.isPending) {
    content = (
      <p role="status" className="text-sm text-muted-foreground">
        Carregando entregas...
      </p>
    );
  } else if (query.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(query.error)}
        </Alert>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (query.data.items.length === 0) {
    content = (
      <p className="text-sm text-muted-foreground">
        {status === "all" ? "Nenhuma entrega ainda." : "Nenhuma entrega com esta situação."}
      </p>
    );
  } else {
    content = (
      <ul className="flex flex-col gap-2">
        {query.data.items.map((delivery) => (
          <li key={delivery.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{EVENT_LABELS[delivery.event]}</span>
              <span className={cn("font-medium", STATUS_STYLE[delivery.status])}>{STATUS_LABELS[delivery.status]}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(delivery.created_at)} · {delivery.attempts}{" "}
              {delivery.attempts === 1 ? "tentativa" : "tentativas"} · {httpText(delivery)}
            </p>
            {delivery.last_error && <p className="mt-1 text-xs text-destructive">{delivery.last_error}</p>}
            {delivery.response_excerpt && (
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                {delivery.response_excerpt}
              </pre>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico de entregas</DialogTitle>
          <DialogDescription>
            Avisos enviados para <strong>{webhook.name}</strong>, do mais recente para o mais antigo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <label htmlFor="deliveries-status" className="text-sm">
            Situação
          </label>
          <Select
            id="deliveries-status"
            value={status}
            className="w-40"
            onChange={(event) => {
              setStatus(event.target.value as DeliveryStatus | "all");
              setPage(0);
            }}
          >
            <option value="all">Todas</option>
            <option value="delivered">Entregues</option>
            <option value="pending">Pendentes</option>
            <option value="failed">Com falha</option>
            <option value="expired">Expiradas</option>
          </Select>
        </div>

        {content}

        {total > DELIVERIES_PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Mais recentes
            </Button>
            <span className="text-muted-foreground">
              Página {page + 1} de {lastPage + 1}
            </span>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
              Mais antigas
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

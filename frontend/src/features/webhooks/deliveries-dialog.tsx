import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { DELIVERIES_PAGE_SIZE, useDeliveries, type DeliveryStatus, type Webhook } from "@/api/webhooks";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { eventLabel, formatDateTime, httpText, statusLabel } from "./presentation";
import { Trans, useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const [status, setStatus] = useState<DeliveryStatus | "all">("all");
  const [page, setPage] = useState(0);
  const query = useDeliveries({ webhookId: webhook.id, status, page });
  const total = query.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / DELIVERIES_PAGE_SIZE) - 1);

  let content;
  if (query.isPending) {
    content = (
      <p role="status" className="text-sm text-muted-foreground">
        {t("webhooks.deliveriesDialog.carregandoEntregas")}
      </p>
    );
  } else if (query.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(query.error)}
        </Alert>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else if (query.data.items.length === 0) {
    content = (
      <p className="text-sm text-muted-foreground">
        {status === "all" ? t("webhooks.deliveriesDialog.nenhumaEntregaAinda") : t("webhooks.deliveriesDialog.nenhumaEntregaComEsta")}
      </p>
    );
  } else {
    content = (
      <ul className="flex flex-col gap-2">
        {query.data.items.map((delivery) => (
          <li key={delivery.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{eventLabel(delivery.event)}</span>
              <span className={cn("font-medium", STATUS_STYLE[delivery.status])}>{statusLabel(delivery.status)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("webhooks.deliveriesDialog.resumo", {
                count: delivery.attempts,
                date: formatDateTime(delivery.created_at),
                http: httpText(delivery),
              })}
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
          <DialogTitle>{t("webhooks.deliveriesDialog.historicoDeEntregas")}</DialogTitle>
          <DialogDescription>
            <Trans i18nKey="webhooks.deliveriesDialog.avisosEnviadosPara" values={{ name: webhook.name }} components={{ strong: <strong /> }} />
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <label htmlFor="deliveries-status" className="text-sm">
            {t("webhooks.deliveriesDialog.situacao")}
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
            <option value="all">{t("common.todas")}</option>
            <option value="delivered">{t("webhooks.deliveriesDialog.entregues")}</option>
            <option value="pending">{t("webhooks.deliveriesDialog.pendentes")}</option>
            <option value="failed">{t("webhooks.deliveriesDialog.comFalha")}</option>
            <option value="expired">{t("webhooks.deliveriesDialog.expiradas")}</option>
          </Select>
        </div>

        {content}

        {total > DELIVERIES_PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              {t("webhooks.deliveriesDialog.maisRecentes")}
            </Button>
            <span className="text-muted-foreground">{t("webhooks.deliveriesDialog.paginaDe", { page: page + 1, total: lastPage + 1 })}</span>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
              {t("webhooks.deliveriesDialog.maisAntigas")}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>{t("common.fechar")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

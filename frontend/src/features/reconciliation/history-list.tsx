import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import {
  useReconciliationHistory,
  useUndoReconciliation,
  type ClosedReconciliation,
} from "@/api/reconciliation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { historyStatus, lockedText } from "./presentation";
import { useTranslation } from "react-i18next";

type Props = { accountId: string; currencyCode: string };

function UndoDialog({
  item,
  currencyCode,
  accountId,
  onClose,
}: {
  item: ClosedReconciliation;
  currencyCode: string;
  accountId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const undo = useUndoReconciliation(accountId);
  const [error, setError] = useState<string | null>(null);
  const busy = undo.isPending;

  async function confirm() {
    setError(null);
    try {
      await undo.mutateAsync(item.id);
      onClose();
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("reconciliation.historyList.desfazerConciliacao")}</DialogTitle>
          <DialogDescription>
            {t("reconciliation.historyList.conciliacaoDeixaDeValer", {
              date: formatDate(item.statement_date),
              amount: formatMoney(item.statement_balance, currencyCode),
              locked: lockedText(item.locked_count).toLowerCase(),
              count: item.locked_count,
            })}
          </DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancelar")}
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? t("reconciliation.historyList.desfazendo") : t("reconciliation.historyList.desfazer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** As conciliacoes ja fechadas da conta, da mais nova para a mais antiga. */
export function HistoryList({ accountId, currencyCode }: Props) {
  const { t } = useTranslation();
  const history = useReconciliationHistory(accountId);
  const [undoing, setUndoing] = useState<ClosedReconciliation | null>(null);

  if (history.isPending) return <p className="text-sm text-muted-foreground">{t("reconciliation.historyList.carregandoHistorico")}</p>;
  if (history.isError) return <Alert variant="destructive">{getErrorMessage(history.error)}</Alert>;
  if (history.data.length === 0) return <p className="text-sm text-muted-foreground">{t("reconciliation.historyList.estaContaAindaNao")}</p>;

  return (
    <>
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {history.data.map((item) => {
          const status = historyStatus(item);
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="font-medium">
                  {t("reconciliation.historyList.extratoDe", { date: formatDate(item.statement_date), amount: formatMoney(item.statement_balance, currencyCode) })}
                </p>
                <p className="text-xs text-muted-foreground">{lockedText(item.locked_count)}</p>
              </div>
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-xs",
                  status.active ? "bg-accent text-positive" : "bg-muted text-muted-foreground",
                )}
              >
                {status.label}
              </span>
              {status.active && (
                <Button size="sm" variant="outline" onClick={() => setUndoing(item)}>
                  {t("reconciliation.historyList.desfazer")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {undoing && <UndoDialog item={undoing} currencyCode={currencyCode} accountId={accountId} onClose={() => setUndoing(null)} />}
    </>
  );
}

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
          <DialogTitle>Desfazer conciliação</DialogTitle>
          <DialogDescription>
            A conciliação de {formatDate(item.statement_date)} ({formatMoney(item.statement_balance, currencyCode)}) deixa de valer e{" "}
            {lockedText(item.locked_count).toLowerCase()} {item.locked_count === 1 ? "volta" : "voltam"} a poder ser editado. Os
            lançamentos continuam marcados como conferidos.
          </DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? "Desfazendo..." : "Desfazer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** As conciliacoes ja fechadas da conta, da mais nova para a mais antiga. */
export function HistoryList({ accountId, currencyCode }: Props) {
  const history = useReconciliationHistory(accountId);
  const [undoing, setUndoing] = useState<ClosedReconciliation | null>(null);

  if (history.isPending) return <p className="text-sm text-muted-foreground">Carregando histórico...</p>;
  if (history.isError) return <Alert variant="destructive">{getErrorMessage(history.error)}</Alert>;
  if (history.data.length === 0) return <p className="text-sm text-muted-foreground">Esta conta ainda não teve conciliação fechada.</p>;

  return (
    <>
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {history.data.map((item) => {
          const status = historyStatus(item);
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="font-medium">
                  Extrato de {formatDate(item.statement_date)} · {formatMoney(item.statement_balance, currencyCode)}
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
                  Desfazer
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

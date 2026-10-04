import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useCreateAdjustment, type ReconciliationView, type Statement } from "@/api/reconciliation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/dates";
import { adjustmentPreview } from "./presentation";

type Props = {
  statement: Statement;
  view: ReconciliationView;
  onClose: () => void;
};

/** Pede confirmacao antes de criar o lancamento que zera a diferenca. Nada e criado sem isso. */
export function AdjustmentDialog({ statement, view, onClose }: Props) {
  const create = useCreateAdjustment(statement.accountId);
  const [error, setError] = useState<string | null>(null);
  const preview = adjustmentPreview(view.difference, view.currency_code);
  const busy = create.isPending;

  async function confirm() {
    setError(null);
    try {
      await create.mutateAsync(statement);
      onClose();
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar lançamento de ajuste</DialogTitle>
          <DialogDescription>
            {preview ? (
              <>
                Vai criar <strong>{preview.text}</strong> na conta <strong>{view.account_name}</strong>, com a data{" "}
                {formatDate(statement.date)} e a descrição “Ajuste de conciliacao”. Ele já entra marcado como conferido e a diferença
                zera.
              </>
            ) : (
              "Não há diferença para ajustar."
            )}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Use o ajuste só quando você já conferiu os lançamentos e a diferença é algo que o app não conhece (uma tarifa, um rendimento).
        </p>

        {error && <Alert variant="destructive">{error}</Alert>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void confirm()} disabled={busy || !preview}>
            {busy ? "Criando..." : "Criar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

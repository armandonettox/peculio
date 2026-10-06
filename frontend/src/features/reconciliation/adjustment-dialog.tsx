import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useCreateAdjustment, type ReconciliationView, type Statement } from "@/api/reconciliation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/dates";
import { adjustmentPreview } from "./presentation";
import { Trans, useTranslation } from "react-i18next";

type Props = {
  statement: Statement;
  view: ReconciliationView;
  onClose: () => void;
};

/** Pede confirmacao antes de criar o lancamento que zera a diferenca. Nada e criado sem isso. */
export function AdjustmentDialog({ statement, view, onClose }: Props) {
  const { t } = useTranslation();
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
          <DialogTitle>{t("reconciliation.adjustmentDialog.criarLancamentoDeAjuste")}</DialogTitle>
          <DialogDescription>
            {preview ? (
              <Trans
                i18nKey="reconciliation.adjustmentDialog.vaiCriar"
                values={{ text: preview.text, account: view.account_name, date: formatDate(statement.date) }}
                components={{ strong: <strong /> }}
              />
            ) : (
              t("reconciliation.adjustmentDialog.naoHaDiferencaPara")
            )}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("reconciliation.adjustmentDialog.useOAjusteSo")}
        </p>

        {error && <Alert variant="destructive">{error}</Alert>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancelar")}
          </Button>
          <Button onClick={() => void confirm()} disabled={busy || !preview}>
            {busy ? t("reconciliation.adjustmentDialog.criando") : t("reconciliation.adjustmentDialog.criarAjuste")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

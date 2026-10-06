import { useState } from "react";

import { useDeleteAccount, useUpdateAccount, type Account } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trans, useTranslation } from "react-i18next";

type Props = { account: Account; onClose: () => void };

export function DeleteAccountDialog({ account, onClose }: Props) {
  const { t } = useTranslation();
  const remove = useDeleteAccount();
  const update = useUpdateAccount();
  const [error, setError] = useState<string | null>(null);
  // Conta com transacoes nao pode ser excluida: o caminho certo e arquivar
  const [hasMovement, setHasMovement] = useState(false);
  const busy = remove.isPending || update.isPending;

  async function confirmDelete() {
    setError(null);
    try {
      await remove.mutateAsync(account.id);
      onClose();
    } catch (failure) {
      setHasMovement(failure instanceof ApiError && failure.code === "account_has_transactions");
      setError(getErrorMessage(failure));
    }
  }

  async function archiveInstead() {
    setError(null);
    try {
      await update.mutateAsync({ id: account.id, body: { active: false } });
      onClose();
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("accounts.deleteAccountDialog.excluirConta")}</DialogTitle>
          <DialogDescription>
            <Trans i18nKey="accounts.deleteAccountDialog.description" values={{ name: account.name }} components={{ strong: <strong /> }} />
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive">{error}</Alert>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.cancelar")}
          </Button>
          {hasMovement ? (
            <Button onClick={archiveInstead} disabled={busy}>
              {t("accounts.deleteAccountDialog.arquivarEmVezDisso")}
            </Button>
          ) : (
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {remove.isPending ? t("accounts.deleteAccountDialog.excluindo") : t("common.excluir")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

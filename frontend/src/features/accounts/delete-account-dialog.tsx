import { useState } from "react";

import { useDeleteAccount, useUpdateAccount, type Account } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = { account: Account; onClose: () => void };

export function DeleteAccountDialog({ account, onClose }: Props) {
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
          <DialogTitle>Excluir conta</DialogTitle>
          <DialogDescription>
            Excluir a conta <strong>{account.name}</strong> não pode ser desfeito. Se você só quer tirá-la da lista,
            arquive.
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive">{error}</Alert>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          {hasMovement ? (
            <Button onClick={archiveInstead} disabled={busy}>
              Arquivar em vez disso
            </Button>
          ) : (
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {remove.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

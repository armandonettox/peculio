import { Coins, Plus } from "lucide-react";
import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useDeletePiggyBank, usePiggyBanks, type PiggyBank } from "@/api/piggy-banks";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PiggyBankCard, type PiggyAction } from "@/features/piggy-banks/piggy-bank-card";
import { PiggyBankFormDialog } from "@/features/piggy-banks/piggy-bank-form-dialog";
import { PiggyBankHistoryDialog } from "@/features/piggy-banks/piggy-bank-history-dialog";
import { PiggyBankMoneyDialog } from "@/features/piggy-banks/piggy-bank-money-dialog";
import { todayLocal } from "@/lib/dates";

type DialogState = { kind: "create" } | { kind: PiggyAction; piggy: PiggyBank } | null;

export default function PiggyBanksPage() {
  const today = todayLocal();
  const [dialog, setDialog] = useState<DialogState>(null);
  const query = usePiggyBanks();
  const remove = useDeletePiggyBank();
  const items = query.data ?? [];

  const newButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      Novo cofrinho
    </Button>
  );

  let content;
  if (query.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        {[0, 1].map((index) => (
          <div key={index} className="h-32 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          Carregando cofrinhos...
        </p>
      </div>
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
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={Coins}
        title="Nenhum cofrinho ainda"
        description="Separe um valor de uma conta para uma meta, como viagem ou reserva de emergência. O dinheiro continua na conta; só deixa de aparecer como disponível."
        action={newButton}
      />
    );
  } else {
    content = (
      <ul className="flex flex-col gap-3">
        {items.map((piggy) => (
          <PiggyBankCard
            key={piggy.id}
            piggy={piggy}
            today={today}
            onAction={(action, item) => setDialog({ kind: action, piggy: item })}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader title="Cofrinhos" description="Metas guardadas dentro das suas contas" actions={newButton} />

      {content}

      {dialog?.kind === "create" && <PiggyBankFormDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <PiggyBankFormDialog piggy={dialog.piggy} onClose={() => setDialog(null)} />}
      {(dialog?.kind === "add" || dialog?.kind === "remove") && (
        <PiggyBankMoneyDialog piggy={dialog.piggy} kind={dialog.kind} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "history" && <PiggyBankHistoryDialog piggy={dialog.piggy} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title="Excluir cofrinho"
          itemName={dialog.piggy.name}
          consequence="O valor guardado volta a ficar disponível na conta; nenhum dinheiro some."
          onConfirm={() => remove.mutateAsync(dialog.piggy.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

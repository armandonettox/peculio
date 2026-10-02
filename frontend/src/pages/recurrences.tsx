import { Plus, Repeat } from "lucide-react";
import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import {
  useDeleteRecurrence,
  useRecurrences,
  useUpdateRecurrence,
  type Recurrence,
} from "@/api/recurrences";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RecurrenceCard } from "@/features/recurrences/recurrence-card";
import { TransactionFormDialog } from "@/features/transactions/transaction-form-dialog";
import { todayLocal } from "@/lib/dates";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; recurrence: Recurrence }
  | { kind: "delete"; recurrence: Recurrence }
  | null;

export default function RecurrencesPage() {
  const today = todayLocal();
  const [includePaused, setIncludePaused] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useRecurrences({ includePaused });
  const update = useUpdateRecurrence();
  const remove = useDeleteRecurrence();
  const items = query.data ?? [];

  async function toggleActive(recurrence: Recurrence) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: recurrence.id, body: { active: !recurrence.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  const newButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      Nova recorrente
    </Button>
  );

  let content;
  if (query.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        {[0, 1].map((index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          Carregando recorrentes...
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
        icon={Repeat}
        title="Nenhuma recorrente ainda"
        description="Cadastre o que se repete sozinho, como aluguel ou salário, e o app cria os lançamentos por você, inclusive os dias em que ele esteve desligado."
        action={newButton}
      />
    );
  } else {
    content = (
      <ul className="flex flex-col gap-3">
        {items.map((recurrence) => (
          <RecurrenceCard
            key={recurrence.id}
            recurrence={recurrence}
            today={today}
            onEdit={(item) => setDialog({ kind: "edit", recurrence: item })}
            onToggleActive={(item) => void toggleActive(item)}
            onDelete={(item) => setDialog({ kind: "delete", recurrence: item })}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageHeader title="Recorrentes" description="Lançamentos que se repetem sozinhos" actions={newButton} />

      <div className="mb-4 flex justify-end">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includePaused}
            onChange={(event) => setIncludePaused(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          Mostrar pausadas
        </label>
      </div>

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "create" && <TransactionFormDialog repeating onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && (
        <TransactionFormDialog recurrence={dialog.recurrence} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title="Excluir recorrente"
          itemName={dialog.recurrence.name}
          consequence="Os lançamentos que ela já criou continuam; só deixam de ser criados novos."
          onConfirm={() => remove.mutateAsync(dialog.recurrence.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

import { Plus, Repeat } from "lucide-react";
import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useDeleteRecurrence, useRecurrences, useUpdateRecurrence, type Recurrence } from "@/api/recurrences";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RecurrenceCard } from "@/features/recurrences/recurrence-card";
import { TransactionFormDialog } from "@/features/transactions/transaction-form-dialog";
import { appToday } from "@/lib/dates";
import { useTranslation } from "react-i18next";

type DialogState = { kind: "create" } | { kind: "edit"; item: Recurrence } | { kind: "delete"; item: Recurrence } | null;

/** O que se repete sozinho: cada recorrente cria o seu lancamento a cada vencimento. */
export function RecurrencesSection() {
  const { t } = useTranslation();
  const today = appToday();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useRecurrences({ includePaused: includeInactive });
  const update = useUpdateRecurrence();
  const remove = useDeleteRecurrence();

  // Os lembretes de conta a pagar foram convertidos em recorrencias automaticas pendentes: so estas ficam
  const items = (query.data ?? []).filter((item) => item.auto_create);
  const isPending = query.isPending;
  const isError = query.isError;

  async function toggleActive(item: Recurrence) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: item.id, body: { active: !item.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  const newButtons = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      {t("pages.recurrences.novaRecorrente")}
    </Button>
  );

  const showToolbarButton = !isPending && !isError && items.length > 0;

  let content;
  if (isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        {[0, 1].map((index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted" />
        ))}
        <p className="sr-only" role="status">
          {t("pages.recurrences.carregandoRecorrentes")}
        </p>
      </div>
    );
  } else if (isError) {
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
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={Repeat}
        title={t("pages.recurrences.nenhumaRecorrenteAinda")}
        description={t("pages.recurrences.cadastreOQueSe")}
        action={newButtons}
      />
    );
  } else {
    content = (
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <RecurrenceCard
            key={item.id}
            recurrence={item}
            today={today}
            onEdit={(picked) => setDialog({ kind: "edit", item: picked })}
            onToggleActive={(picked) => void toggleActive(picked)}
            onDelete={(picked) => setDialog({ kind: "delete", item: picked })}
          />
        ))}
      </ul>
    );
  }

  const editing = dialog?.kind === "edit" ? dialog.item : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          {t("pages.recurrences.mostrarInativas")}
        </label>
        {/* So com a lista carregada e com itens; na vazia o botao ja aparece dentro do aviso */}
        {showToolbarButton && newButtons}
      </div>

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "create" && <TransactionFormDialog repeating onClose={() => setDialog(null)} />}
      {editing && <TransactionFormDialog recurrence={editing} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title={t("pages.recurrences.excluirRecorrente")}
          itemName={dialog.item.name}
          consequence={t("pages.recurrences.osLancamentosQueEla")}
          onConfirm={() => remove.mutateAsync(dialog.item.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

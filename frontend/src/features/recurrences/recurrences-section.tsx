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
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RecurrenceCard } from "@/features/recurrences/recurrence-card";
import { TransactionFormDialog } from "@/features/transactions/transaction-form-dialog";
import { appToday } from "@/lib/dates";
import { useTranslation } from "react-i18next";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; recurrence: Recurrence }
  | { kind: "delete"; recurrence: Recurrence }
  | null;

/** Lancamentos que se repetem sozinhos (aluguel, salario...), criados pelo app a cada ciclo. */
export function RecurrencesSection() {
  const { t } = useTranslation();
  const today = appToday();
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
      {t("pages.recurrences.novaRecorrente")}
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
          {t("pages.recurrences.carregandoRecorrentes")}
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
      {/* h2, nao h1: o h1 da pagina fica por conta de quem encaixa esta aba */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-primary-text">{t("pages.recurrences.recorrentes")}</h2>
          <p className="text-sm text-muted-foreground">{t("pages.recurrences.lancamentosQueSeRepetem")}</p>
        </div>
        {newButton}
      </div>

      <div className="mb-4 flex justify-end">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includePaused}
            onChange={(event) => setIncludePaused(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          {t("pages.recurrences.mostrarPausadas")}
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
          title={t("pages.recurrences.excluirRecorrente")}
          itemName={dialog.recurrence.name}
          consequence={t("pages.recurrences.osLancamentosQueEla")}
          onConfirm={() => remove.mutateAsync(dialog.recurrence.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

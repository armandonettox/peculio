import { Plus, Repeat } from "lucide-react";
import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import {
  useDeleteRecurrence,
  useRecurrences,
  useRecurrencesStatus,
  useUpdateRecurrence,
  type Recurrence,
  type RecurrenceStatus,
} from "@/api/recurrences";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RecurrenceCard } from "@/features/recurrences/recurrence-card";
import { RecurrenceKindDialog } from "@/features/recurrences/recurrence-kind-dialog";
import { ReminderFormDialog } from "@/features/recurrences/reminder-form-dialog";
import { TransactionFormDialog } from "@/features/transactions/transaction-form-dialog";
import { appToday } from "@/lib/dates";
import { useTranslation } from "react-i18next";

type Item = Recurrence | RecurrenceStatus;

type DialogState =
  | { kind: "choose" }
  | { kind: "create-auto" }
  | { kind: "create-reminder" }
  | { kind: "edit"; item: Item }
  | { kind: "delete"; item: Item }
  | null;

/** O que vence sempre e o que se repete sozinho, num so lugar: cada item decide, pelo botao
 * "criar o lancamento automaticamente", se o app cria o lancamento sozinho ou so lembra o vencimento. */
export function RecurrencesSection() {
  const { t } = useTranslation();
  const today = appToday();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const autoQuery = useRecurrences({ includePaused: includeInactive });
  const reminderQuery = useRecurrencesStatus({ on: today, includeArchived: includeInactive });
  const update = useUpdateRecurrence();
  const remove = useDeleteRecurrence();

  const autoItems = (autoQuery.data ?? []).filter((item) => item.auto_create);
  const reminderItems = reminderQuery.data ?? [];
  const items: Item[] = [...reminderItems, ...autoItems];
  const isPending = autoQuery.isPending || reminderQuery.isPending;
  const isError = autoQuery.isError || reminderQuery.isError;

  async function toggleActive(item: Item) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: item.id, body: { active: !item.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  const newButtons = (
    <Button onClick={() => setDialog({ kind: "choose" })}>
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
          {getErrorMessage(autoQuery.error ?? reminderQuery.error)}
        </Alert>
        <Button
          variant="outline"
          onClick={() => {
            void autoQuery.refetch();
            void reminderQuery.refetch();
          }}
        >
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

      {dialog?.kind === "choose" && (
        <RecurrenceKindDialog
          onPick={(kind) => setDialog({ kind: kind === "fixed" ? "create-auto" : "create-reminder" })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "create-auto" && <TransactionFormDialog repeating onClose={() => setDialog(null)} />}
      {dialog?.kind === "create-reminder" && <ReminderFormDialog onClose={() => setDialog(null)} />}
      {editing && editing.auto_create && (
        <TransactionFormDialog recurrence={editing} onClose={() => setDialog(null)} />
      )}
      {editing && !editing.auto_create && <ReminderFormDialog recurrence={editing} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title={t("pages.recurrences.excluirRecorrente")}
          itemName={dialog.item.name}
          consequence={
            dialog.item.auto_create ? t("pages.recurrences.osLancamentosQueEla") : t("pages.recurrences.osLancamentosLigadosA")
          }
          onConfirm={() => remove.mutateAsync(dialog.item.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getErrorMessage } from "@/api/error-messages";
import { useDeleteRecurrence, useRecurrence, useUpdateRecurrence } from "@/api/recurrences";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TransactionFormDialog } from "@/features/transactions/transaction-form-dialog";
import { appToday } from "@/lib/dates";
import { createdText, endText, frequencyLabel, nextText, templateSummary } from "./presentation";

type Props = {
  recurrenceId: string;
  onClose: () => void;
};

const badge = "rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground";

/**
 * Gestao de uma recorrencia a partir da tela de Transacoes: ver quando vem o proximo lancamento e ate quando, editar, pausar
 * ou retomar e excluir a serie. E o que antes ficava so na pagina Recorrentes.
 */
export function RecurrenceManageDialog({ recurrenceId, onClose }: Props) {
  const { t } = useTranslation();
  const query = useRecurrence(recurrenceId);
  const update = useUpdateRecurrence();
  const remove = useDeleteRecurrence();
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [error, setError] = useState<string | null>(null);
  // Marca a exclusao concluida: depois dela nao ha o que mostrar, entao fecha tudo em vez de voltar ao resumo
  const deleted = useRef(false);

  const recurrence = query.data;

  async function toggleActive() {
    if (!recurrence) return;
    setError(null);
    try {
      await update.mutateAsync({ id: recurrence.id, body: { active: !recurrence.active } });
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  if (recurrence && mode === "edit") {
    return <TransactionFormDialog recurrence={recurrence} onClose={onClose} />;
  }

  if (recurrence && mode === "delete") {
    return (
      <ConfirmDeleteDialog
        title={t("pages.recurrences.excluirRecorrente")}
        itemName={recurrence.name}
        consequence={t("pages.recurrences.osLancamentosQueEla")}
        onConfirm={async () => {
          await remove.mutateAsync(recurrence.id);
          deleted.current = true;
        }}
        onClose={() => (deleted.current ? onClose() : setMode("view"))}
      />
    );
  }

  const paused = recurrence ? !recurrence.active : false;
  // Terminada nao pode ser pausada nem retomada: nao ha mais o que criar
  const canToggle = recurrence ? !recurrence.ended : false;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{recurrence ? recurrence.name : t("recurrences.manageDialog.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("recurrences.manageDialog.description")}</DialogDescription>
        </DialogHeader>

        {query.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("recurrences.manageDialog.loading")}
          </p>
        )}
        {query.isError && <Alert variant="destructive">{getErrorMessage(query.error)}</Alert>}
        {error && <Alert variant="destructive">{error}</Alert>}

        {recurrence && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={badge}>{t("recurrences.recurrenceCard.automatica")}</span>
              {paused && <span className={badge}>{t("recurrences.recurrenceCard.pausada")}</span>}
              {recurrence.ended && <span className={badge}>{t("recurrences.recurrenceCard.terminou")}</span>}
            </div>
            <p className="break-words text-sm text-muted-foreground">
              {frequencyLabel(recurrence.frequency)} · {templateSummary(recurrence.template)}
            </p>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <p>{nextText(recurrence, appToday())}</p>
              <p>
                {endText(recurrence)}
                {recurrence.created_count > 0 && !recurrence.max_occurrences ? ` · ${createdText(recurrence.created_count)}` : ""}
              </p>
            </div>
            {paused && !recurrence.ended && (
              <p className="text-xs text-muted-foreground">{t("recurrences.recurrenceCard.aoRetomarOPeriodo")}</p>
            )}
            {recurrence.last_error && (
              <p className="text-sm text-destructive" role="alert">
                {t("recurrences.recurrenceCard.naoFoiPossivelCriar", { error: recurrence.last_error })}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {recurrence && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setMode("edit")}>
                <Pencil />
                {t("common.editar")}
              </Button>
              {canToggle && (
                <Button type="button" variant="outline" onClick={() => void toggleActive()} disabled={update.isPending}>
                  {recurrence.active ? <Pause /> : <Play />}
                  {recurrence.active ? t("recurrences.recurrenceCard.pausar") : t("recurrences.recurrenceCard.retomar")}
                </Button>
              )}
              <Button type="button" variant="destructive" onClick={() => setMode("delete")}>
                <Trash2 />
                {t("common.excluir")}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

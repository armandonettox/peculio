import { ChevronLeft, ChevronRight, PiggyBank, Plus } from "lucide-react";
import { useState } from "react";

import { useBudgetsProgress, useDeleteBudget, useUpdateBudget, type BudgetProgress } from "@/api/budgets";
import { getErrorMessage } from "@/api/error-messages";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BudgetCard } from "@/features/budgets/budget-card";
import { BudgetFormDialog } from "@/features/budgets/budget-form-dialog";
import { firstOfMonth, formatMonthYear, shiftMonth, appToday } from "@/lib/dates";
import { useTranslation } from "react-i18next";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; budget: BudgetProgress }
  | { kind: "delete"; budget: BudgetProgress }
  | null;

/** Um limite de gasto por categoria (mercado, lazer...); acompanha quanto ja foi usado do limite. */
export function BudgetsSection() {
  const { t } = useTranslation();
  const today = appToday();
  const currentMonth = firstOfMonth(today);
  const [month, setMonth] = useState(currentMonth);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // No mes atual o periodo e o de hoje; nos outros meses, o que contem o dia 1
  const on = month === currentMonth ? today : month;
  const query = useBudgetsProgress({ on, includeArchived });
  const update = useUpdateBudget();
  const remove = useDeleteBudget();
  const items = query.data ?? [];

  async function toggleArchive(budget: BudgetProgress) {
    setActionError(null);
    try {
      await update.mutateAsync({ id: budget.id, body: { active: !budget.active } });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  }

  const newButton = (
    <Button onClick={() => setDialog({ kind: "create" })}>
      <Plus />
      {t("pages.budgets.novoOrcamento")}
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
          {t("pages.budgets.carregandoOrcamentos")}
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
        icon={PiggyBank}
        title={t("pages.budgets.nenhumOrcamentoAinda")}
        description={t("pages.budgets.crieUmLimiteDe")}
        action={newButton}
      />
    );
  } else {
    content = (
      <ul className="flex flex-col gap-3">
        {items.map((budget) => (
          <BudgetCard
            key={budget.id}
            budget={budget}
            onEdit={(item) => setDialog({ kind: "edit", budget: item })}
            onToggleArchive={(item) => void toggleArchive(item)}
            onDelete={(item) => setDialog({ kind: "delete", budget: item })}
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
          <h2 className="text-lg font-semibold text-primary-text">{t("pages.budgets.orcamentos")}</h2>
          <p className="text-sm text-muted-foreground">{t("pages.budgets.quantoVoceJaUsou")}</p>
        </div>
        {newButton}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("pages.budgets.mesAnterior")}
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <p aria-live="polite" className="min-w-40 text-center text-sm font-medium">
            {formatMonthYear(month)}
          </p>
          <Button variant="outline" size="icon" aria-label={t("pages.budgets.proximoMes")} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
          {month !== currentMonth && (
            <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth)}>
              {t("pages.budgets.mesAtual")}
            </Button>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            className="accent-[var(--primary)]"
          />
          {t("pages.budgets.mostrarArquivados")}
        </label>
      </div>

      {actionError && (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      )}

      {content}

      {dialog?.kind === "create" && <BudgetFormDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <BudgetFormDialog budget={dialog.budget} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title={t("pages.budgets.excluirOrcamento")}
          itemName={dialog.budget.name}
          consequence={t("pages.budgets.osLancamentosLigadosA")}
          onConfirm={() => remove.mutateAsync(dialog.budget.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

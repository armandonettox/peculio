import { ChevronLeft, ChevronRight, PiggyBank, Plus } from "lucide-react";
import { useState } from "react";

import { useBudgetsProgress, useDeleteBudget, useUpdateBudget, type BudgetProgress } from "@/api/budgets";
import { getErrorMessage } from "@/api/error-messages";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BudgetCard } from "@/features/budgets/budget-card";
import { BudgetFormDialog } from "@/features/budgets/budget-form-dialog";
import { firstOfMonth, formatMonthYear, shiftMonth, appToday } from "@/lib/dates";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; budget: BudgetProgress }
  | { kind: "delete"; budget: BudgetProgress }
  | null;

export default function BudgetsPage() {
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
      Novo orçamento
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
          Carregando orçamentos...
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
        icon={PiggyBank}
        title="Nenhum orçamento ainda"
        description="Crie um limite de gasto para uma parte do seu dinheiro, como mercado ou lazer, e acompanhe quanto já usou."
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
      <PageHeader title="Orçamentos" description="Quanto você já usou do limite de cada gasto" actions={newButton} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Mês anterior"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <p aria-live="polite" className="min-w-40 text-center text-sm font-medium">
            {formatMonthYear(month)}
          </p>
          <Button variant="outline" size="icon" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
          {month !== currentMonth && (
            <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth)}>
              Mês atual
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
          Mostrar arquivados
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
          title="Excluir orçamento"
          itemName={dialog.budget.name}
          consequence="Os lançamentos ligados a ele continuam, só ficam sem orçamento."
          onConfirm={() => remove.mutateAsync(dialog.budget.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

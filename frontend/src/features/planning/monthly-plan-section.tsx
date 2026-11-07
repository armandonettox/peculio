import { ChevronLeft, ChevronRight, ClipboardList, MoreVertical, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import {
  useCopyPreviousPlan,
  useDeleteAllPlans,
  useDeletePlanItem,
  useMonthlyPlan,
  type PlanRow,
} from "@/api/plans";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMonthYear } from "@/lib/dates";
import { CardCountingDialog } from "./card-counting-dialog";
import { NewBudgetDialog } from "./new-budget-dialog";
import { PlanTable } from "./plan-table";
import { PlanHeadline, PlanStatCards } from "./plan-summary";
import { monthStart, shiftMonthKey } from "./presentation";

type Dialog =
  | { kind: "new" }
  | { kind: "edit"; row: PlanRow }
  | { kind: "delete"; row: PlanRow }
  | { kind: "card" }
  | { kind: "deleteAll" }
  | null;

type Props = {
  // O mes mostrado, "AAAA-MM"
  month: string;
  onMonthChange: (month: string) => void;
};

/** O Planejamento Mensal: o mes escolhido, com a tabela por categoria e o resumo, ou o convite para criar o planejamento. */
export function MonthlyPlanSection({ month, onMonthChange }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useMonthlyPlan(month);
  const copy = useCopyPreviousPlan();
  const removeItem = useDeletePlanItem();
  const removeAll = useDeleteAllPlans();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = query.data ?? null;
  const monthLabel = formatMonthYear(monthStart(month));
  const planner = `/orcamentos/planejar?mes=${month}`;

  async function copyPrevious() {
    setError(null);
    try {
      await copy.mutateAsync(month);
    } catch (failure) {
      // Sem planejamento no mes anterior: a mensagem generica diria "neste mes", que confunde aqui
      setError(
        failure instanceof ApiError && failure.code === "monthly_plan_not_found"
          ? t("planning.empty.nothingToCopy")
          : getErrorMessage(failure),
      );
    }
  }

  const monthNav = (
    <div className="flex items-center justify-center gap-1">
      <Button size="icon" variant="ghost" className="size-8" aria-label={t("planning.monthPrev")} onClick={() => onMonthChange(shiftMonthKey(month, -1))}>
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-36 rounded-full border px-4 py-1 text-center text-sm font-medium" aria-live="polite">
        {monthLabel}
      </span>
      <Button size="icon" variant="ghost" className="size-8" aria-label={t("planning.monthNext")} onClick={() => onMonthChange(shiftMonthKey(month, 1))}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );

  let content;
  if (query.isPending) {
    content = (
      <div aria-busy="true" className="flex flex-col gap-3">
        <div className="h-24 animate-pulse rounded-lg border bg-muted" />
        <div className="h-48 animate-pulse rounded-lg border bg-muted" />
        <p className="sr-only" role="status">
          {t("planning.loading")}
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
  } else if (!plan) {
    content = (
      <div className="flex flex-col items-center gap-4 rounded-lg border bg-card px-6 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary-text">
          <ClipboardList className="size-7" aria-hidden="true" />
        </div>
        <p className="text-sm text-muted-foreground">{t("planning.empty.title", { month: monthLabel })}</p>
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => navigate(planner)}>{t("planning.empty.define")}</Button>
          <Button variant="ghost" onClick={() => void copyPrevious()} disabled={copy.isPending}>
            {copy.isPending ? t("planning.saving") : t("planning.empty.copy")}
          </Button>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <PlanHeadline plan={plan} />
          <div className="rounded-lg border bg-card p-2">
            <PlanTable
              plan={plan}
              monthLabel={monthLabel}
              onEdit={(row) => setDialog({ kind: "edit", row })}
              onDelete={(row) => setDialog({ kind: "delete", row })}
            />
          </div>
        </div>
        <PlanStatCards plan={plan} />
      </div>
    );
  }

  return (
    <section aria-label={t("planning.mode.monthly")} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {monthNav}
        <div className="flex items-center gap-2">
          {plan && (
            <Button variant="outline" onClick={() => setDialog({ kind: "new" })}>
              <Plus />
              {t("planning.actions.new")}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-9" aria-label={t("planning.actions.menu")}>
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {plan && (
                <>
                  <DropdownMenuItem onSelect={() => navigate(planner)}>{t("planning.actions.edit")}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "card" })}>{t("planning.actions.cardView")}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem className="text-destructive" onSelect={() => setDialog({ kind: "deleteAll" })}>
                {t("planning.actions.deleteAll")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {content}

      {dialog?.kind === "new" && plan && <NewBudgetDialog plan={plan} onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && plan && <NewBudgetDialog plan={plan} editing={dialog.row} onClose={() => setDialog(null)} />}
      {dialog?.kind === "card" && plan && (
        <CardCountingDialog month={month} current={plan.card_counting} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDeleteDialog
          title={t("planning.deleteItem.title")}
          itemName={dialog.row.category_name ?? ""}
          consequence={t("planning.deleteItem.consequence")}
          onConfirm={() => removeItem.mutateAsync({ month, categoryId: dialog.row.category_id! })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "deleteAll" && (
        <ConfirmDeleteDialog
          title={t("planning.deleteAll.title")}
          itemName={t("planning.deleteAll.item")}
          consequence={t("planning.deleteAll.consequence")}
          onConfirm={() => removeAll.mutateAsync()}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

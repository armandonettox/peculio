import { Archive, ArchiveRestore, MoreVertical, Pencil, Trash2 } from "lucide-react";

import type { BudgetProgress } from "@/api/budgets";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { periodLabel, progressState, remainingText, stateLabel, type ProgressState } from "./presentation";
import { useTranslation } from "react-i18next";

type Props = {
  budget: BudgetProgress;
  onEdit: (budget: BudgetProgress) => void;
  onToggleArchive: (budget: BudgetProgress) => void;
  onDelete: (budget: BudgetProgress) => void;
};

const FILL_CLASS: Record<ProgressState, string> = {
  // primary-text e navy no tema claro e a versao clara dele no escuro; o navy puro some no fundo escuro
  ok: "bg-primary-text",
  warning: "bg-warning",
  over: "bg-destructive",
};

const TEXT_CLASS: Record<ProgressState, string> = {
  ok: "text-muted-foreground",
  warning: "text-warning",
  over: "text-destructive",
};

export function BudgetCard({ budget, onEdit, onToggleArchive, onDelete }: Props) {
  const { t } = useTranslation();
  const state = progressState(budget.percent);
  const label = stateLabel(state);
  // A barra enche ate 100%; o excesso aparece no texto ("Passou R$ 30,00 do limite")
  const filled = Math.min(budget.percent, 100);

  return (
    <li className={cn("rounded-lg border bg-card p-4 text-card-foreground shadow-sm", !budget.active && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate text-base font-semibold">{budget.name}</h3>
            {!budget.active && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t("budgets.budgetCard.arquivado")}</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {periodLabel(budget.period)} · {formatDateRange(budget.period_start, budget.period_end)}
            {budget.currency_code !== "BRL" ? ` · ${budget.currency_code}` : ""}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("budgets.budgetCard.acoesDoOrcamento", { name: budget.name })}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={() => onEdit(budget)}>
              <Pencil />
              {t("common.editar")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleArchive(budget)}>
              {budget.active ? <Archive /> : <ArchiveRestore />}
              {budget.active ? t("budgets.budgetCard.arquivar") : t("budgets.budgetCard.restaurar")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(budget)} className="text-destructive">
              <Trash2 />
              {t("common.excluir")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        role="progressbar"
        aria-label={t("budgets.budgetCard.gastoDe", { name: budget.name })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={filled}
        aria-valuetext={t("budgets.budgetCard.percentDoLimite", { percent: budget.percent })}
        className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-[width]", FILL_CLASS[state])} style={{ width: `${filled}%` }} />
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{formatMoney(budget.spent, budget.currency_code)}</span>
          <span className="text-muted-foreground"> {t("budgets.budgetCard.de")} {formatMoney(budget.amount ?? "0", budget.currency_code)}</span>
        </p>
        <p className={cn("text-sm", TEXT_CLASS[state])}>
          {label && <span className="font-medium">{label} · </span>}
          {remainingText(budget)}
        </p>
      </div>
    </li>
  );
}

import { Link } from "react-router-dom";

import { useBudgetsProgress } from "@/api/budgets";
import { PERIOD_LABELS, progressState, remainingText, STATE_LABELS, type ProgressState } from "@/features/budgets/presentation";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { DashboardBlock } from "./dashboard-block";
import { closestToLimit } from "./presentation";

const FILL_CLASS: Record<ProgressState, string> = {
  ok: "bg-primary-text",
  warning: "bg-warning",
  over: "bg-destructive",
};

/** Os 4 orcamentos mais perto do limite, com a mesma barra e percentual da pagina de orcamentos. */
export function BudgetsBlock({ today }: { today: string }) {
  const query = useBudgetsProgress({ on: today, includeArchived: false });
  const items = closestToLimit(query.data ?? [], 4);

  return (
    <DashboardBlock
      title="Orçamentos"
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={items.length === 0}
      empty={<p className="text-sm text-muted-foreground">Nenhum orçamento ativo ainda.</p>}
    >
      <ul className="flex flex-col gap-4">
        {items.map((budget) => {
          const state = progressState(budget.percent);
          const stateLabel = STATE_LABELS[state];
          const filled = Math.min(budget.percent, 100);
          return (
            <li key={budget.id} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium">{budget.name}</p>
                <p className="shrink-0 text-xs text-muted-foreground">{PERIOD_LABELS[budget.period]}</p>
              </div>
              <div
                role="progressbar"
                aria-label={`Gasto de ${budget.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={filled}
                aria-valuetext={`${budget.percent}% do limite`}
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className={cn("h-full rounded-full", FILL_CLASS[state])} style={{ width: `${filled}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatMoney(budget.spent, budget.currency_code)} de {formatMoney(budget.amount, budget.currency_code)}
                {stateLabel ? ` · ${stateLabel}` : ` · ${remainingText(budget)}`}
              </p>
            </li>
          );
        })}
      </ul>
      <Link to="/orcamentos" className="mt-4 inline-block text-sm font-medium text-primary-text hover:underline">
        Ver orçamentos
      </Link>
    </DashboardBlock>
  );
}

import { ArrowDown, ArrowUp, PiggyBank, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MonthlyPlan } from "@/api/plans";
import { KpiCard } from "@/components/kpi-card";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PercentDots, PlanBar } from "./plan-parts";
import { formatPercent, isOver } from "./presentation";

/** O resumo do mes no topo da tabela: quanto resta do orcamento de gastos e a barra de pago e previsto. */
export function PlanHeadline({ plan }: { plan: MonthlyPlan }) {
  const { t } = useTranslation();
  const { summary } = plan;
  const money = (value: string) => formatMoney(value, plan.currency_code);
  const over = isOver(summary.remaining);
  const amounts = { planned: summary.planned_spending, paid: summary.spent_paid, expected: summary.spent_expected };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-sm text-muted-foreground">{over ? t("planning.summary.over") : t("planning.summary.remaining")}</p>
          <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", over && "text-destructive")}>
            {money(over ? summary.remaining.replace("-", "") : summary.remaining)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("planning.summary.spentOf", { spent: money(summary.spent_total), planned: money(summary.planned_spending) })}
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-1.5">
          <PlanBar
            amounts={amounts}
            label={t("planning.row.barLabel", {
              name: t("planning.summary.title"),
              paid: money(summary.spent_paid),
              expected: money(summary.spent_expected),
              planned: money(summary.planned_spending),
            })}
          />
          <PercentDots amounts={amounts} />
        </div>
      </div>
    </div>
  );
}

/** Os quatro cartoes ao lado da tabela: receita real do mes, gastos planejados, balanco e economia planejada. */
export function PlanStatCards({ plan }: { plan: MonthlyPlan }) {
  const { t } = useTranslation();
  const { summary } = plan;
  const money = (value: string) => formatMoney(value, plan.currency_code);
  const negativeBalance = Number(summary.planned_balance) < 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
      <KpiCard
        icon={ArrowUp}
        iconClassName="bg-positive/15 text-positive"
        label={t("planning.cards.income")}
        value={money(summary.month_income)}
      />
      <KpiCard
        icon={ArrowDown}
        iconClassName="bg-destructive/15 text-destructive"
        label={t("planning.cards.plannedSpending")}
        value={money(summary.planned_spending)}
      />
      <KpiCard
        icon={Scale}
        label={t("planning.cards.plannedBalance")}
        value={money(summary.planned_balance)}
        valueColor={negativeBalance ? "destructive" : "default"}
      />
      <KpiCard
        icon={PiggyBank}
        iconClassName="bg-positive/15 text-positive"
        label={t("planning.cards.plannedSavings")}
        value={formatPercent(Number(summary.planned_savings_percent))}
        valueColor={negativeBalance ? "destructive" : "default"}
      />
    </div>
  );
}

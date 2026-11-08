import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useReportMonthly, useReportSummary } from "@/api/reports";
import { BarChart } from "@/components/charts";
import type { LineSeries } from "@/components/charts";
import { currentIntlLocale } from "@/i18n";
import { shortMonthLabel } from "@/features/reports/presentation";
import { appToday } from "@/lib/dates";
import { monthsEndingAt, type MonthRange } from "@/lib/month";
import { formatMoney, isNegativeMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { DashboardBlock } from "./dashboard-block";
import { useMonthTransactions } from "./use-month-transactions";

const LINK_CLASS = "mt-4 inline-block text-sm font-medium text-primary-text hover:underline";

// 2024-01-07 e um domingo: serve de base para os nomes dos dias da semana no idioma da tela
function weekdayName(index: number, width: "short" | "narrow"): string {
  return new Intl.DateTimeFormat(currentIntlLocale(), { weekday: width, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + index)));
}

function dayOfWeek(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Calendario do mes: os dias com movimento ganham um ponto e levam a lista daquele dia. */
export function CalendarBlock({ range }: { range: MonthRange }) {
  const { t } = useTranslation();
  const { query, items } = useMonthTransactions(range);
  const today = appToday();

  const daysWithMovement = new Map<string, number>();
  for (const transaction of items) {
    for (const split of transaction.splits) {
      if (split.date >= range.from && split.date <= range.to) daysWithMovement.set(split.date, (daysWithMovement.get(split.date) ?? 0) + 1);
    }
  }

  const lastDay = Number(range.to.slice(8, 10));
  const offset = dayOfWeek(range.from);
  const cells: (number | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length: lastDay }, (_, index) => index + 1)];

  return (
    <DashboardBlock
      title={t("dashboard.calendarBlock.title")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={t("dashboard.calendarBlock.title")}>
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} role="columnheader" aria-label={weekdayName(index, "short")} className="py-1 text-xs text-muted-foreground">
            {weekdayName(index, "narrow")}
          </span>
        ))}
        {cells.map((day, index) => {
          if (day === null) return <span key={`empty-${index}`} role="gridcell" aria-hidden="true" />;
          const date = `${range.month.slice(0, 8)}${String(day).padStart(2, "0")}`;
          const count = daysWithMovement.get(date) ?? 0;
          const cell = (
            <span
              className={cn(
                "flex h-9 flex-col items-center justify-center rounded-md text-sm tabular-nums",
                date === today && "border border-primary-text font-semibold",
                count > 0 ? "hover:bg-muted" : "text-muted-foreground",
              )}
            >
              {day}
              <span className={cn("mt-0.5 size-1 rounded-full", count > 0 ? "bg-primary-text" : "bg-transparent")} aria-hidden="true" />
            </span>
          );
          return (
            <span key={date} role="gridcell">
              {count > 0 ? (
                <Link to={`/transacoes?de=${date}&ate=${date}`} aria-label={t("dashboard.calendarBlock.dayWithMovement", { day, count })} className="block">
                  {cell}
                </Link>
              ) : (
                cell
              )}
            </span>
          );
        })}
      </div>
    </DashboardBlock>
  );
}

/** Em que dia da semana a pessoa mais gasta: quantidade de despesas do mes por dia da semana. */
export function FrequencyBlock({ range }: { range: MonthRange }) {
  const { t } = useTranslation();
  const { query, items, isComplete } = useMonthTransactions(range);

  const counts = Array<number>(7).fill(0);
  for (const transaction of items) {
    for (const split of transaction.splits) {
      if (split.type === "withdrawal" && !split.ignored && split.date >= range.from && split.date <= range.to) counts[dayOfWeek(split.date)] += 1;
    }
  }
  const total = counts.reduce((sum, value) => sum + value, 0);
  const series: LineSeries = {
    key: "frequency",
    label: t("dashboard.frequencyBlock.expensesCount"),
    color: "negative",
    points: counts.map((value, index) => ({ x: String(index), value: String(value) })),
  };

  return (
    <DashboardBlock
      title={t("dashboard.frequencyBlock.title")}
      isLoading={query.isPending || !isComplete}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={total === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.frequencyBlock.empty")}</p>}
    >
      <BarChart
        title={t("dashboard.frequencyBlock.chartTitle")}
        series={[series]}
        // Contagem so tem valor inteiro: as marcas fracionadas do eixo (0,25 despesa) ficam sem rotulo
        formatValue={(value) => (Number.isInteger(Number(value)) ? t("dashboard.frequencyBlock.count", { count: Number(value) }) : "")}
        formatX={(x) => weekdayName(Number(x), "short")}
        height={160}
      />
    </DashboardBlock>
  );
}

/** Receitas e despesas dos ultimos `months` meses, terminando no mes escolhido (3 = trimestral, 6 = semestral). */
export function PeriodBalanceBlock({ range, months }: { range: MonthRange; months: 3 | 6 }) {
  const { t } = useTranslation();
  const span = monthsEndingAt(range, months);
  const query = useReportMonthly({ dateFrom: span.from, dateTo: span.to });
  const blocks = query.data?.currencies ?? [];

  return (
    <DashboardBlock
      title={months === 6 ? t("dashboard.periodBalanceBlock.semester") : t("dashboard.periodBalanceBlock.quarter")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={blocks.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.periodBalanceBlock.empty")}</p>}
    >
      <div className="flex flex-col gap-4">
        {blocks.map((block) => (
          <div key={block.currency_code} className="min-w-0">
            {blocks.length > 1 && <h3 className="mb-1 text-sm font-semibold text-muted-foreground">{block.currency_code}</h3>}
            <BarChart
              title={t("dashboard.periodBalanceBlock.chartTitle", { months, currency: block.currency_code })}
              series={[
                { key: `${block.currency_code}-income`, label: t("dashboard.presentation.receita"), color: "positive", points: block.months.map((point) => ({ x: point.month, value: point.income })) },
                { key: `${block.currency_code}-expense`, label: t("dashboard.presentation.despesa"), color: "negative", points: block.months.map((point) => ({ x: point.month, value: point.expense })) },
              ]}
              formatValue={(value) => formatMoney(value, block.currency_code)}
              formatX={shortMonthLabel}
              height={160}
            />
          </div>
        ))}
      </div>
    </DashboardBlock>
  );
}

/** Quanto sobrou no mes (receita menos despesa) e que parte da receita isso representa. */
export function SavingsBlock({ range }: { range: MonthRange }) {
  const { t } = useTranslation();
  const query = useReportSummary({ dateFrom: range.from, dateTo: range.to });
  const currencies = query.data?.currencies ?? [];

  return (
    <DashboardBlock
      title={t("dashboard.savingsBlock.title")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={currencies.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.savingsBlock.empty")}</p>}
    >
      <ul className="flex flex-col gap-3">
        {currencies.map((totals) => {
          const income = Number(totals.income);
          const percent = income > 0 ? Math.round((Number(totals.net) / income) * 100) : null;
          return (
            <li key={totals.currency_code}>
              <p className={cn("text-xl font-semibold tabular-nums", isNegativeMoney(totals.net) ? "text-destructive" : "text-positive")}>
                {formatMoney(totals.net, totals.currency_code)}
              </p>
              <p className="text-sm text-muted-foreground">
                {percent === null ? t("dashboard.savingsBlock.noIncome") : t("dashboard.savingsBlock.ofIncome", { percent })}
              </p>
            </li>
          );
        })}
      </ul>
      <Link to="/relatorios" className={LINK_CLASS}>
        {t("dashboard.verMais")}
      </Link>
    </DashboardBlock>
  );
}

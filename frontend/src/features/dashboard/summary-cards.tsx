import { ArrowDown, ArrowUp, ChevronRight, CreditCard, Landmark, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAccounts, useCurrencies } from "@/api/accounts";
import { useNetWorth } from "@/api/dashboard";
import { useReportSummary } from "@/api/reports";
import type { MonthRange } from "@/lib/month";
import { formatMoney, isNegativeMoney, negateMoney, placesOf, sumMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Line = { currency: string; value: string; tone?: "positive" | "destructive" };

type CardProps = {
  to: string;
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  lines: Line[];
  isLoading: boolean;
  isError: boolean;
  emptyText: string;
};

function SummaryCard({ to, icon: Icon, iconClassName, label, lines, isLoading, isError, emptyText }: CardProps) {
  const { t } = useTranslation();
  return (
    <Link
      to={to}
      className="flex min-w-0 items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/50"
    >
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", iconClassName)}>
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        {isLoading ? (
          <div aria-busy="true" className="mt-1 h-6 w-24 animate-pulse rounded bg-muted" />
        ) : isError ? (
          <p className="text-sm text-destructive">{t("dashboard.summaryCards.unavailable")}</p>
        ) : lines.length === 0 ? (
          <p className="text-lg font-semibold tabular-nums">{emptyText}</p>
        ) : (
          lines.map((line) => (
            <p
              key={line.currency}
              className={cn(
                "truncate text-lg font-semibold tabular-nums",
                line.tone === "positive" && "text-positive",
                line.tone === "destructive" && "text-destructive",
              )}
            >
              {formatMoney(line.value, line.currency)}
            </p>
          ))
        )}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/**
 * Os quatro cards do topo: saldo (patrimonio liquido de hoje), receitas e despesas do mes escolhido e a divida dos
 * cartoes. Cada um leva a tela de detalhe, ja filtrada no mes quando faz sentido.
 */
export function SummaryCards({ range }: { range: MonthRange }) {
  const { t } = useTranslation();
  const netWorth = useNetWorth({ months: 12, forecastMonths: 3 });
  const summary = useReportSummary({ dateFrom: range.from, dateTo: range.to });
  const accounts = useAccounts({ includeArchived: false });
  const currencyList = useCurrencies();
  const places = Object.fromEntries((currencyList.data ?? []).map((item) => [item.code, item.decimal_places]));

  const totals = summary.data?.currencies ?? [];
  const period = `de=${range.from}&ate=${range.to}`;

  // Divida de cada cartao ativo, por moeda: o saldo de cartao e negativo quando ha fatura a pagar
  const cardDebt = new Map<string, string[]>();
  for (const account of accounts.data ?? []) {
    if (account.role !== "credit_card" || !account.active || !isNegativeMoney(account.balance)) continue;
    cardDebt.set(account.currency_code, [...(cardDebt.get(account.currency_code) ?? []), negateMoney(account.balance)]);
  }
  const cardLines: Line[] = [...cardDebt.entries()].map(([currency, values]) => ({
    currency,
    value: sumMoney(values, placesOf(currency, places)),
    tone: "destructive",
  }));

  return (
    <div data-testid="summary-cards" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        to="/contas"
        icon={Landmark}
        iconClassName="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
        label={t("dashboard.summaryCards.currentBalance")}
        isLoading={netWorth.isPending}
        isError={netWorth.isError}
        emptyText="-"
        lines={(netWorth.data?.currencies ?? []).map((item) => ({
          currency: item.currency_code,
          value: item.net,
          tone: isNegativeMoney(item.net) ? "destructive" : undefined,
        }))}
      />
      <SummaryCard
        to={`/transacoes?tipo=deposit&${period}`}
        icon={ArrowUp}
        iconClassName="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
        label={t("dashboard.summaryCards.income")}
        isLoading={summary.isPending}
        isError={summary.isError}
        emptyText={formatMoney("0.00", "BRL")}
        lines={totals.map((item) => ({ currency: item.currency_code, value: item.income, tone: "positive" }))}
      />
      <SummaryCard
        to={`/transacoes?tipo=withdrawal&${period}`}
        icon={ArrowDown}
        iconClassName="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
        label={t("dashboard.summaryCards.expenses")}
        isLoading={summary.isPending}
        isError={summary.isError}
        emptyText={formatMoney("0.00", "BRL")}
        lines={totals.map((item) => ({ currency: item.currency_code, value: item.expense }))}
      />
      <SummaryCard
        to="/cartoes"
        icon={CreditCard}
        iconClassName="bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
        label={t("dashboard.summaryCards.creditCard")}
        isLoading={accounts.isPending}
        isError={accounts.isError}
        emptyText={formatMoney("0.00", "BRL")}
        lines={cardLines}
      />
    </div>
  );
}

import { ArrowDown, ArrowUp, Eye, EyeOff, Landmark, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAccounts, useCurrencies } from "@/api/accounts";
import { useBudgetsProgress } from "@/api/budgets";
import { useNetWorth, useUpcoming } from "@/api/dashboard";
import { useReportSummary } from "@/api/reports";
import { MonthPicker } from "@/components/month-picker";
import { UserMenu } from "@/components/user-menu";
import { Button } from "@/components/ui/button";
import { AccountFormDialog } from "@/features/accounts/account-form-dialog";
import { totalsByCurrency } from "@/features/accounts/totals";
import { appToday } from "@/lib/dates";
import type { MonthRange } from "@/lib/month";
import { formatMoney, isNegativeMoney, sumMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { HIDDEN_VALUE, useHideValues } from "./hide-values";
import { buildAlerts } from "./presentation";
import { useMonthTransactions } from "./use-month-transactions";

type Props = {
  range: MonthRange;
  currentMonth: string;
  onMonthChange: (month: string) => void;
};

type Money = { currency: string; value: string };

// Soma os valores por moeda: real com real, dolar com dolar (moedas diferentes nunca se somam)
function sumByCurrency(items: Money[]): Money[] {
  const byCurrency = new Map<string, string[]>();
  for (const item of items) byCurrency.set(item.currency, [...(byCurrency.get(item.currency) ?? []), item.value]);
  return [...byCurrency.entries()].map(([currency, values]) => ({ currency, value: sumMoney(values, 2) }));
}

/** O topo da tela inicial no celular: avatar, mes, saldo grande, o olho e receitas e despesas lado a lado. */
function TopPanel({ range, currentMonth, onMonthChange }: Props) {
  const { t } = useTranslation();
  const { hidden, toggle } = useHideValues();
  const netWorth = useNetWorth({ months: 12, forecastMonths: 3 });
  const summary = useReportSummary({ dateFrom: range.from, dateTo: range.to });
  const totals = summary.data?.currencies ?? [];
  const show = (value: string, currency: string) => (hidden ? HIDDEN_VALUE : formatMoney(value, currency));

  return (
    <section aria-label={t("dashboard.mobile.summary")} className="rounded-b-3xl bg-card px-5 pb-6 pt-4 shadow-sm">
      <h1 className="sr-only">{t("pages.dashboard.painel")}</h1>
      <div className="grid grid-cols-[2.25rem_1fr_2.25rem] items-center">
        <UserMenu />
        <div className="flex justify-center">
          <MonthPicker value={range.month} currentMonth={currentMonth} onChange={onMonthChange} variant="plain" />
        </div>
        <span aria-hidden="true" />
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">{t("dashboard.mobile.currentBalance")}</p>
      <div className="mt-1 flex flex-col items-center">
        {netWorth.isPending ? (
          <div aria-busy="true" className="h-10 w-40 animate-pulse rounded bg-muted" />
        ) : netWorth.isError ? (
          <p className="text-sm text-destructive">{t("dashboard.summaryCards.unavailable")}</p>
        ) : (
          (netWorth.data?.currencies ?? []).map((item, index) => (
            <p
              key={item.currency_code}
              className={cn(
                "font-semibold tabular-nums",
                index === 0 ? "text-4xl" : "text-xl text-muted-foreground",
                index === 0 && isNegativeMoney(item.net) && "text-destructive",
              )}
            >
              {show(item.net, item.currency_code)}
            </p>
          ))
        )}
      </div>
      <div className="mt-2 flex justify-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-pressed={hidden}
          aria-label={hidden ? t("dashboard.mobile.showValues") : t("dashboard.mobile.hideValues")}
        >
          {hidden ? <EyeOff /> : <Eye />}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link to={`/transacoes?tipo=deposit&de=${range.from}&ate=${range.to}`} className="flex min-w-0 items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-positive text-white" aria-hidden="true">
            <ArrowUp className="size-6" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm text-muted-foreground">{t("dashboard.summaryCards.income")}</span>
            {summary.isPending ? (
              <span aria-busy="true" className="mt-1 block h-5 w-20 animate-pulse rounded bg-muted" />
            ) : totals.length === 0 ? (
              <span className="block truncate text-lg font-semibold text-positive tabular-nums">{show("0", "BRL")}</span>
            ) : (
              totals.map((item) => (
                <span key={item.currency_code} className="block truncate text-lg font-semibold text-positive tabular-nums">
                  {show(item.income, item.currency_code)}
                </span>
              ))
            )}
          </span>
        </Link>
        <Link to={`/transacoes?tipo=withdrawal&de=${range.from}&ate=${range.to}`} className="flex min-w-0 items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-destructive text-white" aria-hidden="true">
            <ArrowDown className="size-6" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm text-muted-foreground">{t("dashboard.summaryCards.expenses")}</span>
            {summary.isPending ? (
              <span aria-busy="true" className="mt-1 block h-5 w-20 animate-pulse rounded bg-muted" />
            ) : totals.length === 0 ? (
              <span className="block truncate text-lg font-semibold text-destructive tabular-nums">{show("0", "BRL")}</span>
            ) : (
              totals.map((item) => (
                <span key={item.currency_code} className="block truncate text-lg font-semibold text-destructive tabular-nums">
                  {show(item.expense, item.currency_code)}
                </span>
              ))
            )}
          </span>
        </Link>
      </div>
    </section>
  );
}

type AlertCard = { key: string; to: string; title: string; count: number; amounts: Money[]; tone: "expense" | "income" | "alert" };

const TONE_CLASS = { expense: "text-destructive", income: "text-positive", alert: "text-destructive" } as const;

/** "Pendencias e alertas": cartoes lado a lado, que rolam para o lado quando nao cabem. */
function PendingAndAlerts({ range }: { range: MonthRange }) {
  const { t } = useTranslation();
  const { items } = useMonthTransactions(range, { status: "pending" });
  const upcoming = useUpcoming({ days: 30 });
  const budgets = useBudgetsProgress({ on: appToday(), includeArchived: false });
  const period = `de=${range.from}&ate=${range.to}`;

  const pending = (type: "withdrawal" | "deposit") => {
    const splits = items.flatMap((transaction) => transaction.splits).filter((split) => split.type === type && !split.ignored);
    return { count: splits.length, amounts: sumByCurrency(splits.map((split) => ({ currency: split.currency_code, value: split.amount }))) };
  };
  const expenses = pending("withdrawal");
  const incomes = pending("deposit");

  const cards: AlertCard[] = [];
  if (expenses.count > 0) {
    cards.push({ key: "expenses", to: `/transacoes?situacao=pending&tipo=withdrawal&${period}`, title: t("dashboard.mobile.pendingExpenses"), count: expenses.count, amounts: expenses.amounts, tone: "expense" });
  }
  if (incomes.count > 0) {
    cards.push({ key: "incomes", to: `/transacoes?situacao=pending&tipo=deposit&${period}`, title: t("dashboard.mobile.pendingIncomes"), count: incomes.count, amounts: incomes.amounts, tone: "income" });
  }
  if (upcoming.data && budgets.data) {
    for (const alert of buildAlerts(upcoming.data.items, budgets.data)) {
      cards.push({ key: alert.key, to: alert.href, title: alert.text, count: 0, amounts: [], tone: "alert" });
    }
  }

  return (
    <section aria-labelledby="mobile-alerts-title" className="mt-6">
      <h2 id="mobile-alerts-title" className="mb-3 px-1 text-lg text-muted-foreground">
        {t("dashboard.mobile.pendingAndAlerts")}
      </h2>
      {cards.length === 0 ? (
        <p className="rounded-3xl bg-card px-5 py-4 text-sm text-muted-foreground">{t("dashboard.mobile.allClear")}</p>
      ) : (
        <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {cards.map((card) => (
            <li key={card.key} className="shrink-0">
              <Link to={card.to} className="relative flex h-full min-h-36 w-44 flex-col justify-between gap-3 rounded-3xl bg-card p-4">
                {card.count > 0 && (
                  <span className="absolute right-4 top-4 flex size-7 items-center justify-center rounded-full bg-destructive text-xs font-semibold text-white">
                    {card.count}
                  </span>
                )}
                {card.tone === "income" ? <ArrowUp className="size-7 text-positive" aria-hidden="true" /> : <ArrowDown className="size-7" aria-hidden="true" />}
                <span className="text-sm text-muted-foreground">{card.title}</span>
                {card.amounts.map((amount) => (
                  <span key={amount.currency} className={cn("text-lg font-semibold tabular-nums", TONE_CLASS[card.tone])}>
                    {formatMoney(amount.value, amount.currency)}
                  </span>
                ))}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** O cartao de contas: uma linha por conta, o botao de adicionar e o total. */
function AccountsCard() {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const accounts = useAccounts({ includeArchived: false });
  const currencyList = useCurrencies();
  const places = Object.fromEntries((currencyList.data ?? []).map((item) => [item.code, item.decimal_places]));
  const rows = (accounts.data ?? []).filter((account) => account.role !== "credit_card");
  const totals = totalsByCurrency(rows, places);

  return (
    <section aria-labelledby="mobile-accounts-title" className="mt-6">
      <h2 id="mobile-accounts-title" className="mb-3 px-1 text-lg text-muted-foreground">
        {t("dashboard.mobile.accounts")}
      </h2>
      <div className="rounded-3xl bg-card p-5">
        {accounts.isPending ? (
          <div aria-busy="true" className="h-16 animate-pulse rounded-2xl bg-muted" />
        ) : accounts.isError ? (
          <p className="text-sm text-destructive">{t("dashboard.summaryCards.unavailable")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rows.map((account) => (
              <li key={account.id} className="flex items-center gap-4">
                <Landmark className="size-9 shrink-0 text-primary-text" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{account.name}</p>
                  <p className={cn("text-sm tabular-nums", isNegativeMoney(account.balance) ? "text-destructive" : "text-positive")}>
                    {formatMoney(account.balance, account.currency_code)}
                  </p>
                </div>
                <Link
                  to={`/transacoes?conta=${account.id}`}
                  aria-label={t("dashboard.mobile.addExpenseTo", { name: account.name })}
                  className="rounded-full p-2 text-primary-text hover:bg-accent"
                >
                  <Plus className="size-6" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" className="mt-5 h-12 w-full rounded-full text-base" onClick={() => setCreating(true)}>
          {t("dashboard.mobile.addAccount")}
        </Button>
        {totals.length > 0 && (
          <div className="mt-5 flex items-baseline justify-between gap-3 border-t pt-4">
            <span className="font-medium">{t("dashboard.mobile.total")}</span>
            <div className="flex flex-col items-end">
              {totals.map((item) => (
                <span key={item.currency} className="font-semibold tabular-nums">
                  {formatMoney(item.total, item.currency)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      {creating && <AccountFormDialog onClose={() => setCreating(false)} />}
    </section>
  );
}

/**
 * A tela inicial no celular, no estilo do Mobills: topo com saldo, depois "Pendencias e alertas" e o cartao de contas.
 * Os demais blocos que a pessoa deixou ligados vem em seguida, na pagina.
 */
export function MobileHome(props: Props) {
  return (
    // Sangra o espaco de borda do conteudo, para o topo encostar nas laterais e no alto da tela
    <div className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6">
      <TopPanel {...props} />
      <div className="px-4 sm:px-6">
        <PendingAndAlerts range={props.range} />
        <AccountsCard />
      </div>
    </div>
  );
}

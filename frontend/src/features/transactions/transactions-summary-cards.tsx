import { ArrowLeftRight, Landmark, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useAccounts } from "@/api/accounts";
import { useReportSummary } from "@/api/reports";
import { formatMoney } from "@/lib/money";

type Props = {
  dateFrom: string;
  dateTo: string;
};

function sumBalances(accounts: { balance: string; currency_code: string }[], currencyCode: string): string {
  const total = accounts
    .filter((a) => a.currency_code === currencyCode)
    .reduce((sum, a) => sum + parseFloat(a.balance), 0);
  return total.toFixed(2);
}

type CardProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
  currency: string;
  colorClass: string;
};

function SummaryCard({ icon, label, value, currency, colorClass }: CardProps) {
  const amount = parseFloat(value);
  const formatted = formatMoney(value, currency);
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${colorClass}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-sm font-semibold tabular-nums ${amount < 0 ? "text-destructive" : ""}`}>
          {formatted}
        </p>
      </div>
    </div>
  );
}

export function TransactionsSummaryCards({ dateFrom, dateTo }: Props) {
  const { t } = useTranslation();
  const accounts = useAccounts({ includeArchived: false });
  const summary = useReportSummary({ dateFrom, dateTo });

  const activeAccounts = useMemo(() => accounts.data ?? [], [accounts.data]);
  const currencies = summary.data?.currencies ?? [];

  // Usa a primeira moeda encontrada (a principal do usuario)
  const mainCurrency = currencies[0]?.currency_code ?? activeAccounts[0]?.currency_code ?? "BRL";
  const totals = currencies.find((c) => c.currency_code === mainCurrency);

  const currentBalance = useMemo(
    () => sumBalances(activeAccounts.map((a) => ({ balance: a.balance, currency_code: a.currency_code })), mainCurrency),
    [activeAccounts, mainCurrency],
  );

  if (accounts.isPending || summary.isPending) {
    return (
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-xl border bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <SummaryCard
        icon={<Landmark className="size-5 text-white" />}
        label={t("pages.transactions.saldoAtual")}
        value={currentBalance}
        currency={mainCurrency}
        colorClass="bg-blue-500"
      />
      <SummaryCard
        icon={<TrendingUp className="size-5 text-white" />}
        label={t("pages.transactions.receitas")}
        value={totals?.income ?? "0.00"}
        currency={mainCurrency}
        colorClass="bg-green-500"
      />
      <SummaryCard
        icon={<TrendingDown className="size-5 text-white" />}
        label={t("pages.transactions.despesas")}
        value={totals?.expense ?? "0.00"}
        currency={mainCurrency}
        colorClass="bg-red-500"
      />
      <SummaryCard
        icon={<ArrowLeftRight className="size-5 text-white" />}
        label={t("pages.transactions.balanco")}
        value={totals?.net ?? "0.00"}
        currency={mainCurrency}
        colorClass="bg-teal-600"
      />
    </div>
  );
}

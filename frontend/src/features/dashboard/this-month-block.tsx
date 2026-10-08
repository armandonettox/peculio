import { useCurrencies } from "@/api/accounts";
import { useReportSummary } from "@/api/reports";
import { TableScroll } from "@/components/table-scroll";
import { formatMoney, placesOf } from "@/lib/money";
import { DashboardBlock } from "./dashboard-block";
import { compareToLastMonth, findByCurrency, formatDiff, formatPercent, trendFor, type MonthMetric } from "./presentation";
import { useTranslation } from "react-i18next";

const METRICS: { key: MonthMetric; label: string }[] = [
  { key: "income", label: "Receita" },
  { key: "expense", label: "Despesa" },
  { key: "net", label: "Resultado" },
];

const TREND_CLASS = { good: "text-positive", bad: "text-destructive", neutral: "text-muted-foreground" } as const;

/** Receita, despesa e resultado deste mes, comparados com o mes passado. */
export function ThisMonthBlock() {
  const { t } = useTranslation();
  const thisMonth = useReportSummary({ period: "this-month" });
  const lastMonth = useReportSummary({ period: "last-month" });
  // Casas decimais de cada moeda (JPY tem 0, algumas tem 3): a diferenca nao pode truncar nem inventar casas
  const currencyList = useCurrencies();
  const placesByCurrency = Object.fromEntries((currencyList.data ?? []).map((item) => [item.code, item.decimal_places]));

  const isLoading = thisMonth.isPending || lastMonth.isPending;
  const isError = thisMonth.isError || lastMonth.isError;
  const currencies = thisMonth.data?.currencies ?? [];

  return (
    <DashboardBlock
      title={t("dashboard.thisMonthBlock.esteMes")}
      isLoading={isLoading}
      isError={isError}
      error={thisMonth.error ?? lastMonth.error}
      onRetry={() => {
        void thisMonth.refetch();
        void lastMonth.refetch();
      }}
      isEmpty={currencies.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.thisMonthBlock.nenhumaReceitaOuDespesa")}</p>}
    >
      <div className="flex flex-col gap-6">
        {currencies.map((totals) => {
          const previous = findByCurrency(lastMonth.data?.currencies ?? [], totals.currency_code);
          return (
            <section key={totals.currency_code} aria-label={t("dashboard.thisMonthBlock.thisMonthIn", { currency: totals.currency_code })} className="min-w-0">
              {currencies.length > 1 && <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{totals.currency_code}</h3>}
              <TableScroll label={t("dashboard.thisMonthBlock.caption", { currency: totals.currency_code })}>
                <table className="w-full min-w-[22rem] border-collapse text-sm">
                  <caption className="sr-only">
                    {t("dashboard.thisMonthBlock.caption", { currency: totals.currency_code })}
                  </caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-1 font-normal">
                        {t("common.valor")}
                      </th>
                      <th scope="col" className="py-1 font-normal">
                        {t("dashboard.thisMonthBlock.esteMes")}
                      </th>
                      <th scope="col" className="py-1 font-normal">
                        {t("dashboard.thisMonthBlock.diferenca")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map(({ key, label }) => {
                      const current = totals[key];
                      const comparison = compareToLastMonth(current, previous?.[key], placesOf(totals.currency_code, placesByCurrency));
                      const trend = trendFor(key, comparison.diff);
                      return (
                        <tr key={key} className="border-t">
                          <th scope="row" className="whitespace-nowrap py-2 pr-3 text-left font-medium">
                            {label}
                          </th>
                          <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{formatMoney(current, totals.currency_code)}</td>
                          <td className={`py-2 tabular-nums ${TREND_CLASS[trend]}`}>
                            {formatDiff(comparison.diff, totals.currency_code)} · {formatPercent(comparison.percent)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </section>
          );
        })}
      </div>
    </DashboardBlock>
  );
}

import { useCurrencies } from "@/api/accounts";
import { useReportSummary } from "@/api/reports";
import { TableScroll } from "@/components/table-scroll";
import { useMediaQuery } from "@/hooks/use-media-query";
import { shiftMonthRange, type MonthRange } from "@/lib/month";
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

/** Receita, despesa e resultado do mes escolhido, comparados com o mes anterior a ele. */
export function ThisMonthBlock({ range }: { range: MonthRange }) {
  const { t } = useTranslation();
  // No celular o cartao e estreito demais para tres colunas: cada linha vira nome e valor, com a diferenca embaixo
  const desktop = useMediaQuery("(min-width: 1024px)");
  const previousRange = shiftMonthRange(range, -1);
  const thisMonth = useReportSummary({ dateFrom: range.from, dateTo: range.to });
  const lastMonth = useReportSummary({ dateFrom: previousRange.from, dateTo: previousRange.to });
  // Casas decimais de cada moeda (JPY tem 0, algumas tem 3): a diferenca nao pode truncar nem inventar casas
  const currencyList = useCurrencies();
  const placesByCurrency = Object.fromEntries((currencyList.data ?? []).map((item) => [item.code, item.decimal_places]));

  const isLoading = thisMonth.isPending || lastMonth.isPending;
  const isError = thisMonth.isError || lastMonth.isError;
  const currencies = thisMonth.data?.currencies ?? [];

  return (
    <DashboardBlock
      title={t("dashboard.thisMonthBlock.balancoMensal")}
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
          const rows = METRICS.map(({ key, label }) => {
            const current = totals[key];
            const comparison = compareToLastMonth(current, previous?.[key], placesOf(totals.currency_code, placesByCurrency));
            // Sem mes passado para comparar, o percentual nao existe: mostra so a diferenca
            const diffText = `${formatDiff(comparison.diff, totals.currency_code)}${comparison.percent !== null ? ` · ${formatPercent(comparison.percent)}` : ""}`;
            return { key, label, current, diffText, trend: trendFor(key, comparison.diff) };
          });
          return (
            <section key={totals.currency_code} aria-label={t("dashboard.thisMonthBlock.thisMonthIn", { currency: totals.currency_code })} className="min-w-0">
              {currencies.length > 1 && <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{totals.currency_code}</h3>}
              {desktop ? (
                <TableScroll label={t("dashboard.thisMonthBlock.caption", { currency: totals.currency_code })}>
                  <table className="w-full min-w-[22rem] table-fixed border-collapse text-sm">
                    <colgroup>
                      <col className="w-[24%]" />
                      <col className="w-[28%]" />
                      <col />
                    </colgroup>
                    <caption className="sr-only">
                      {t("dashboard.thisMonthBlock.caption", { currency: totals.currency_code })}
                    </caption>
                    <thead>
                      <tr className="text-left text-sm text-muted-foreground">
                        <th scope="col" className="py-1 font-normal">
                          {t("common.valor")}
                        </th>
                        <th scope="col" className="py-1 font-normal">
                          {t("dashboard.thisMonthBlock.selectedMonth")}
                        </th>
                        <th scope="col" className="py-1 font-normal">
                          {t("dashboard.thisMonthBlock.diferenca")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ key, label, current, diffText, trend }) => (
                        <tr key={key} className="border-t">
                          <th scope="row" className="whitespace-nowrap py-2 pr-3 text-left font-medium">
                            {label}
                          </th>
                          <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{formatMoney(current, totals.currency_code)}</td>
                          <td className={`py-2 tabular-nums ${TREND_CLASS[trend]}`}>{diffText}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              ) : (
                <dl className="flex flex-col divide-y">
                  {rows.map(({ key, label, current, diffText, trend }) => (
                    <div key={key} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="font-medium">{label}</dt>
                        <dd className="text-lg font-semibold tabular-nums">{formatMoney(current, totals.currency_code)}</dd>
                      </div>
                      <dd className={`mt-0.5 text-right text-xs tabular-nums ${TREND_CLASS[trend]}`}>{diffText}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          );
        })}
      </div>
    </DashboardBlock>
  );
}

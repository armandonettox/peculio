import { useNetWorth } from "@/api/dashboard";
import { LineChart, Sparkline } from "@/components/charts";
import { shortMonthLabel } from "@/features/reports/presentation";
import { formatMoney, isNegativeMoney } from "@/lib/money";
import { DashboardBlock } from "./dashboard-block";
import { netWorthSeries } from "./presentation";

/** Patrimonio de hoje por moeda (liquido, ativos e dividas) e a evolucao dos ultimos meses. */
export function NetWorthBlock() {
  const query = useNetWorth({ months: 12 });
  const currencies = query.data?.currencies ?? [];

  return (
    <DashboardBlock
      title="Patrimônio"
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={currencies.length === 0}
      empty={<p className="text-sm text-muted-foreground">Sem contas para calcular o patrimônio ainda.</p>}
      className="lg:col-span-2"
    >
      <div className="flex flex-col gap-6">
        {currencies.map((currency) => (
          <section key={currency.currency_code} aria-label={`Patrimônio em ${currency.currency_code}`} className="min-w-0">
            {currencies.length > 1 && <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{currency.currency_code}</h3>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Líquido</p>
                <p className={`text-xl font-semibold tabular-nums ${isNegativeMoney(currency.net) ? "text-destructive" : "text-positive"}`}>
                  {formatMoney(currency.net, currency.currency_code)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ativos</p>
                <p className="text-xl font-semibold tabular-nums">{formatMoney(currency.assets, currency.currency_code)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dívidas</p>
                <p className="text-xl font-semibold tabular-nums">{formatMoney(currency.liabilities, currency.currency_code)}</p>
              </div>
            </div>

            {currency.series.length > 1 && (
              <div className="mt-4 hidden sm:block">
                <Sparkline
                  label={`Patrimônio em ${currency.currency_code} nos últimos ${currency.series.length} meses`}
                  values={currency.series.map((point) => point.net)}
                  tone={isNegativeMoney(currency.net) ? "negative" : "positive"}
                />
              </div>
            )}

            <div className="mt-4 min-w-0">
              <LineChart
                title={`Patrimônio líquido em ${currency.currency_code}`}
                series={[netWorthSeries(currency)]}
                formatValue={(value) => formatMoney(value, currency.currency_code)}
                formatX={shortMonthLabel}
                height={220}
              />
            </div>
          </section>
        ))}
      </div>
    </DashboardBlock>
  );
}

import { useNetWorth } from "@/api/dashboard";
import { LineChart } from "@/components/charts";
import { shortMonthLabel } from "@/features/reports/presentation";
import { formatMoney, isNegativeMoney } from "@/lib/money";
import { DashboardBlock } from "./dashboard-block";
import { netWorthSeries } from "./presentation";
import { useTranslation } from "react-i18next";

/** Patrimonio de hoje por moeda (liquido, ativos e dividas) e a evolucao dos ultimos meses. */
export function NetWorthBlock() {
  const { t } = useTranslation();
  const query = useNetWorth({ months: 12 });
  const currencies = query.data?.currencies ?? [];

  return (
    <DashboardBlock
      title={t("dashboard.netWorthBlock.patrimonio")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={currencies.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.netWorthBlock.semContasParaCalcular")}</p>}
    >
      {/* Com mais de uma moeda os graficos ficam lado a lado no desktop, em vez de empilhados */}
      <div data-testid="net-worth-currencies" className={currencies.length > 1 ? "grid grid-cols-1 gap-6 lg:grid-cols-2" : "flex flex-col gap-6"}>
        {currencies.map((currency) => (
          <section key={currency.currency_code} aria-label={t("dashboard.netWorthBlock.netWorthIn", { currency: currency.currency_code })} className="min-w-0">
            {currencies.length > 1 && <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{currency.currency_code}</h3>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">{t("dashboard.netWorthBlock.liquido")}</p>
                <p className={`text-xl font-semibold tabular-nums ${isNegativeMoney(currency.net) ? "text-destructive" : "text-positive"}`}>
                  {formatMoney(currency.net, currency.currency_code)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("dashboard.netWorthBlock.ativos")}</p>
                <p className="text-xl font-semibold tabular-nums">{formatMoney(currency.assets, currency.currency_code)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("dashboard.netWorthBlock.dividas")}</p>
                <p className="text-xl font-semibold tabular-nums">{formatMoney(currency.liabilities, currency.currency_code)}</p>
              </div>
            </div>

            <div className="mt-4 min-w-0">
              <LineChart
                title={t("dashboard.netWorthBlock.netWorthLiquidIn", { currency: currency.currency_code })}
                series={[netWorthSeries(currency)]}
                formatValue={(value) => formatMoney(value, currency.currency_code)}
                formatX={shortMonthLabel}
                height={220}
                area
              />
            </div>
          </section>
        ))}
      </div>
    </DashboardBlock>
  );
}

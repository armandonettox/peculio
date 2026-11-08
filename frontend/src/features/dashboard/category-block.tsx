import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useSpendingForecast } from "@/api/dashboard";
import { useReportGrouped } from "@/api/reports";
import { BarChart, DonutChart, type DonutSlice } from "@/components/charts";
import { Select } from "@/components/ui/select";
import { shortMonthLabel } from "@/features/reports/presentation";
import type { MonthRange } from "@/lib/month";
import { formatMoney } from "@/lib/money";
import { DashboardBlock } from "./dashboard-block";
import { categorySlices, pickCurrency, spendingForecastSeries } from "./presentation";
import { useTranslation } from "react-i18next";

/**
 * Para onde vai o dinheiro no mes escolhido, por categoria (as 6 maiores e "Outras"). `kind` escolhe despesas
 * (com a previsao dos proximos meses) ou receitas.
 */
export function CategoryBlock({ range, kind = "expense" }: { range: MonthRange; kind?: "expense" | "income" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useReportGrouped("category", { dateFrom: range.from, dateTo: range.to });
  const forecastQuery = useSpendingForecast({ months: 3 }, { enabled: kind === "expense" });
  const [selected, setSelected] = useState<string | null>(null);
  const blocks = query.data?.currencies ?? [];
  const forecastCurrencies = kind === "expense" ? (forecastQuery.data?.currencies ?? []) : [];
  const currency = pickCurrency(blocks, selected);
  const block = blocks.find((item) => item.currency_code === currency);
  const slices = block ? categorySlices(block.rows, t("dashboard.categoryBlock.noCategory"), kind) : [];

  return (
    <DashboardBlock
      title={kind === "income" ? t("dashboard.categoryBlock.receitasPorCategoria") : t("dashboard.categoryBlock.gastosPorCategoria")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={slices.length === 0}
      empty={
        <p className="text-sm text-muted-foreground">
          {kind === "income" ? t("dashboard.categoryBlock.nenhumaReceitaNoMes") : t("dashboard.categoryBlock.nenhumaDespesaComCategoria")}
        </p>
      }
      actions={
        blocks.length > 1 ? (
          <Select
            aria-label={t("common.moeda")}
            value={currency ?? ""}
            onChange={(event) => setSelected(event.target.value)}
            className="w-auto"
          >
            {blocks.map((item) => (
              <option key={item.currency_code} value={item.currency_code}>
                {item.currency_code}
              </option>
            ))}
          </Select>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <DonutChart
          title={t(kind === "income" ? "dashboard.categoryBlock.incomeByCategoryIn" : "dashboard.categoryBlock.spendingByCategoryIn", { currency })}
          slices={slices}
          formatValue={(value) => formatMoney(value, currency ?? "BRL")}
          centerLabel="Total"
          centerValue={block ? formatMoney(kind === "income" ? block.income : block.expense, block.currency_code) : undefined}
          maxSlices={6}
          otherLabel="Outras"
          onSliceClick={(slice: DonutSlice) => {
            const type = kind === "income" ? "deposit" : "withdrawal";
            const period = `de=${range.from}&ate=${range.to}`;
            if (slice.key === "__sem_categoria__") {
              void navigate(`/transacoes?tipo=${type}&${period}`);
            } else {
              void navigate(`/transacoes?tipo=${type}&categoria=${slice.key}&${period}`);
            }
          }}
        />
        <Link to="/relatorios" className="text-sm font-medium text-primary-text hover:underline">
          {t("dashboard.categoryBlock.verRelatorios")}
        </Link>
        {forecastCurrencies.map((fc) => (
          <div key={fc.currency_code} className="mt-2 min-w-0">
            <p className="mb-1 text-xs text-muted-foreground">{t("dashboard.categoryBlock.previsaoProximos3Meses", { currency: fc.currency_code })}</p>
            <BarChart
              title={t("dashboard.categoryBlock.previsaoProximos3Meses", { currency: fc.currency_code })}
              series={spendingForecastSeries(fc)}
              formatValue={(value) => formatMoney(value, fc.currency_code)}
              formatX={shortMonthLabel}
              height={140}
            />
          </div>
        ))}
      </div>
    </DashboardBlock>
  );
}

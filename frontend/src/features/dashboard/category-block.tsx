import { useState } from "react";
import { Link } from "react-router-dom";

import { useReportGrouped } from "@/api/reports";
import { DonutChart } from "@/components/charts";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { DashboardBlock } from "./dashboard-block";
import { categorySlices, pickCurrency } from "./presentation";
import { useTranslation } from "react-i18next";

/** Para onde vai o dinheiro neste mes, por categoria (so despesas; as 6 maiores e "Outras"). */
export function CategoryBlock() {
  const { t } = useTranslation();
  const query = useReportGrouped("category", { period: "this-month" });
  const [selected, setSelected] = useState<string | null>(null);
  const blocks = query.data?.currencies ?? [];
  const currency = pickCurrency(blocks, selected);
  const block = blocks.find((item) => item.currency_code === currency);
  const slices = block ? categorySlices(block.rows, t("dashboard.categoryBlock.noCategory")) : [];

  return (
    <DashboardBlock
      title={t("dashboard.categoryBlock.gastosPorCategoria")}
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={slices.length === 0}
      empty={<p className="text-sm text-muted-foreground">{t("dashboard.categoryBlock.nenhumaDespesaComCategoria")}</p>}
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
          title={t("dashboard.categoryBlock.spendingByCategoryIn", { currency })}
          slices={slices}
          formatValue={(value) => formatMoney(value, currency ?? "BRL")}
          centerLabel="Total"
          centerValue={block ? formatMoney(block.expense, block.currency_code) : undefined}
          maxSlices={6}
          otherLabel="Outras"
        />
        <Link to="/relatorios" className="text-sm font-medium text-primary-text hover:underline">
          {t("dashboard.categoryBlock.verRelatorios")}
        </Link>
      </div>
    </DashboardBlock>
  );
}

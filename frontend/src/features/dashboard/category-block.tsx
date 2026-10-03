import { useState } from "react";
import { Link } from "react-router-dom";

import { useReportGrouped } from "@/api/reports";
import { DonutChart } from "@/components/charts";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { DashboardBlock } from "./dashboard-block";
import { categorySlices, pickCurrency } from "./presentation";

/** Para onde vai o dinheiro neste mes, por categoria (so despesas; as 6 maiores e "Outras"). */
export function CategoryBlock() {
  const query = useReportGrouped("category", { period: "this-month" });
  const [selected, setSelected] = useState<string | null>(null);
  const blocks = query.data?.currencies ?? [];
  const currency = pickCurrency(blocks, selected);
  const block = blocks.find((item) => item.currency_code === currency);
  const slices = block ? categorySlices(block.rows, "Sem categoria") : [];

  return (
    <DashboardBlock
      title="Gastos por categoria"
      isLoading={query.isPending}
      isError={query.isError}
      error={query.error}
      onRetry={() => void query.refetch()}
      isEmpty={slices.length === 0}
      empty={<p className="text-sm text-muted-foreground">Nenhuma despesa com categoria neste mês ainda.</p>}
      actions={
        blocks.length > 1 ? (
          <Select
            aria-label="Moeda"
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
          title={`Gastos por categoria em ${currency}`}
          slices={slices}
          formatValue={(value) => formatMoney(value, currency ?? "BRL")}
          centerLabel="Total"
          centerValue={block ? formatMoney(block.expense, block.currency_code) : undefined}
          maxSlices={6}
          otherLabel="Outras"
        />
        <Link to="/relatorios" className="text-sm font-medium text-primary-text hover:underline">
          Ver relatórios
        </Link>
      </div>
    </DashboardBlock>
  );
}

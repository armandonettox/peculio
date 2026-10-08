import { TableScroll } from "@/components/table-scroll";

import type { ReportGroupBlock } from "@/api/reports";
import { formatMoney } from "@/lib/money";
import { barPercent, dimensions, netClass, rowName } from "./presentation";
import { useTranslation } from "react-i18next";

type BreakdownTableProps = {
  dimension: ReturnType<typeof dimensions>[number];
  block: ReportGroupBlock;
};

/** Tabela de receita e despesa por categoria, tag, orcamento ou conta, com uma barra de despesa em CSS. */
export function BreakdownTable({ dimension, block }: BreakdownTableProps) {
  const { t } = useTranslation();
  const code = block.currency_code;
  // As linhas vem do maior gasto para o menor, mas a barra nao depende disso
  const maxExpense = block.rows.reduce((max, row) => (Number(row.expense) > Number(max) ? row.expense : max), "0");

  return (
    <section aria-label={t("reports.breakdownTable.secaoEm", { title: dimension.column, code })} className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{dimension.title}</h4>
      {dimension.note && <p className="text-xs text-muted-foreground">{dimension.note}</p>}
      <TableScroll label={t("reports.breakdownTable.tituloEm", { title: dimension.title, code })}>
        <table className="w-full min-w-96 text-sm">
          <caption className="sr-only">{t("reports.breakdownTable.tituloEm", { title: dimension.title, code })}</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                {dimension.column}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("common.receita")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("common.despesa")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("common.resultado")}
              </th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => {
              const percent = barPercent(row.expense, maxExpense);
              const name = rowName(row, dimension.fallback);
              return (
                <tr key={row.id ?? "none"} className="border-b last:border-0">
                  <th scope="row" className="w-1/2 px-3 py-2 text-left font-normal">
                    <span className="block truncate">{name}</span>
                    {percent > 0 && (
                      <span className="mt-1 block h-1.5 w-full rounded-full bg-muted">
                        <span
                          role="img"
                          aria-label={t("reports.breakdownTable.despesaDePercent", { amount: formatMoney(row.expense, code), percent })}
                          className="block h-full rounded-full bg-destructive"
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                    )}
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-positive">{formatMoney(row.income, code)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-destructive">
                    {formatMoney(row.expense, code)}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${netClass(row.net)}`}>
                    {formatMoney(row.net, code)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </section>
  );
}

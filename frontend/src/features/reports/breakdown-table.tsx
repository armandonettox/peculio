import { TableScroll } from "@/components/table-scroll";
import { useId } from "react";

import type { ReportGroupBlock } from "@/api/reports";
import { formatMoney } from "@/lib/money";
import { barPercent, netClass, rowName, type DIMENSIONS } from "./presentation";

type BreakdownTableProps = {
  dimension: (typeof DIMENSIONS)[number];
  block: ReportGroupBlock;
};

/** Tabela de receita e despesa por categoria, tag, orcamento ou conta, com uma barra de despesa em CSS. */
export function BreakdownTable({ dimension, block }: BreakdownTableProps) {
  const headingId = useId();
  const code = block.currency_code;
  // As linhas vem do maior gasto para o menor, mas a barra nao depende disso
  const maxExpense = block.rows.reduce((max, row) => (Number(row.expense) > Number(max) ? row.expense : max), "0");

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h4 id={headingId} className="text-sm font-semibold">
        {dimension.title}
      </h4>
      {dimension.note && <p className="text-xs text-muted-foreground">{dimension.note}</p>}
      <TableScroll label={`${dimension.title} em ${code}`}>
        <table className="w-full min-w-96 text-sm">
          <caption className="sr-only">
            {dimension.title} em {code}
          </caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                {dimension.column}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Receita
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Despesa
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Resultado
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
                          aria-label={`Despesa de ${formatMoney(row.expense, code)}, ${percent}% do maior gasto da lista`}
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

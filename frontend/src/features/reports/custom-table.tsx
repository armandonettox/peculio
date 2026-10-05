import { useId } from "react";

import type { ReportRow } from "@/api/reports";
import { formatMoney } from "@/lib/money";
import { netClass, rowName } from "./presentation";

type Props = {
  title: string;
  // O nome da primeira coluna ("Categoria", "Mês"...)
  column: string;
  // Texto da linha sem categoria, orcamento ou tag (o servidor manda id nulo)
  fallback: string;
  rows: ReportRow[];
  currencyCode: string;
  note?: string;
};

/** A tabela completa do relatorio, sempre com todos os grupos (os graficos mostram so os maiores). */
export function CustomTable({ title, column, fallback, rows, currencyCode, note }: Props) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h4 id={headingId} className="text-sm font-semibold">
        Todos os grupos
      </h4>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">
            {title} em {currencyCode}
          </caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                {column}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Despesa
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Receita
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Resultado
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Lançamentos
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id ?? "none"} className="border-b last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {rowName(row, fallback)}
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-destructive">
                  {formatMoney(row.expense, currencyCode)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-positive">
                  {formatMoney(row.income, currencyCode)}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${netClass(row.net)}`}>
                  {formatMoney(row.net, currencyCode)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

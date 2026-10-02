import { useId } from "react";

import type { MonthlyBlock } from "@/api/reports";
import { formatMoney } from "@/lib/money";
import { barPercent, longMonthLabel, netClass, shortMonthLabel } from "./presentation";

/**
 * Receita e despesa mes a mes, em barras de CSS. O desenho e so um resumo visual (leitor de tela
 * recebe uma frase) e a tabela logo abaixo tem todos os valores em texto.
 */
export function MonthlyChart({ block }: { block: MonthlyBlock }) {
  const headingId = useId();
  const code = block.currency_code;
  const months = block.months;
  const max = months.reduce((top, point) => {
    const bigger = Number(point.income) > Number(point.expense) ? point.income : point.expense;
    return Number(bigger) > Number(top) ? bigger : top;
  }, "0");
  const first = months[0];
  const last = months[months.length - 1];
  const summary = first
    ? `Receita e despesa por mês em ${code}, de ${longMonthLabel(first.month)} a ${longMonthLabel(last.month)}. Os valores estão na tabela abaixo.`
    : "";

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base font-semibold">
        Mês a mês
      </h3>

      <div className="rounded-lg border bg-card p-4">
        <ul aria-hidden className="mb-3 flex gap-4 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-positive" />
            Receita
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-destructive" />
            Despesa
          </li>
        </ul>
        <div className="overflow-x-auto">
          <div role="img" aria-label={summary} className="flex h-40 items-end gap-2">
            {months.map((point) => (
              <div key={point.month} className="flex h-full min-w-10 flex-1 flex-col items-center justify-end gap-1">
                <div className="flex h-full w-full items-end justify-center gap-0.5">
                  <span
                    className="w-2/5 rounded-t bg-positive"
                    style={{ height: `${barPercent(point.income, max)}%` }}
                  />
                  <span
                    className="w-2/5 rounded-t bg-destructive"
                    style={{ height: `${barPercent(point.expense, max)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{shortMonthLabel(point.month)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-h-72 overflow-auto rounded-lg border bg-card">
        <table className="w-full min-w-96 text-sm">
          <caption className="sr-only">Receita, despesa e resultado por mês em {code}</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                Mês
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
            {months.map((point) => (
              <tr key={point.month} className="border-b last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {longMonthLabel(point.month)}
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-positive">{formatMoney(point.income, code)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-destructive">
                  {formatMoney(point.expense, code)}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${netClass(point.net)}`}>
                  {formatMoney(point.net, code)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

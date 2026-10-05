import type { ReportMeasure } from "@/api/saved-reports";
import { isNegativeMoney, formatMoney } from "@/lib/money";
import { barWidth, type RankedItem } from "./custom-data";

type Props = {
  title: string;
  items: RankedItem[];
  currencyCode: string;
  measure: ReportMeasure;
};

// A cor da barra diz o que ela mede: despesa em vermelho, receita em verde e o saldo pelo sinal. "Outros" fica neutro.
function barClass(item: RankedItem, measure: ReportMeasure): string {
  if (item.isOther) return "bg-muted-foreground";
  if (measure === "expense") return "bg-destructive";
  if (measure === "income") return "bg-positive";
  return isNegativeMoney(item.value) ? "bg-destructive" : "bg-positive";
}

/**
 * Barras horizontais em CSS: uma linha por grupo, com o nome, o valor em texto e a barra. A lista em si ja e legivel
 * por leitor de tela (nome e valor em cada item); o desenho da barra e so visual.
 */
export function RankedBars({ title, items, currencyCode, measure }: Props) {
  return (
    <ul aria-label={title} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="shrink-0 tabular-nums">{formatMoney(item.value, currencyCode)}</span>
          </div>
          <span aria-hidden="true" className="block h-2 w-full rounded-full bg-muted">
            <span className={`block h-full rounded-full ${barClass(item, measure)}`} style={{ width: `${barWidth(item.value, items)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

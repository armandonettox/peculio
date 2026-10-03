import { useState } from "react";

import { cn } from "@/lib/utils";
import { chartColorVar, pickColor } from "./chart-colors";
import { round2, sumDecimals } from "./chart-numbers";
import { ChartTable, ChartTooltip, EmptyChart } from "./chart-parts";
import { arcMidpoint, DEFAULT_MAX_SLICES, groupSlices, ringSlicePath, roundedPercents, sliceAngles } from "./donut-geometry";
import { tooltipPlacement } from "./line-geometry";
import type { DonutChartProps } from "./types";

const SIZE = 200;
const CENTER = SIZE / 2;
const OUTER = 92;
const OUTER_ACTIVE = 96;
const INNER = 58;

// Percentual inteiro; uma fatia que existe mas arredondou para 0 aparece como "<1%"
function percentText(percent: number): string {
  return percent === 0 ? "<1%" : `${percent}%`;
}

/**
 * Rosca em SVG, sem biblioteca. O desenho (role img) resume para leitor de tela; as fatias focaveis ficam
 * numa camada acima, a legenda mostra nome, valor e percentual e a tabela equivalente fica oculta (sr-only).
 */
export function DonutChart({
  title,
  slices,
  formatValue,
  centerLabel,
  centerValue,
  maxSlices = DEFAULT_MAX_SLICES,
  otherLabel = "Outras",
  className,
}: DonutChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const items = groupSlices(slices, maxSlices, otherLabel);
  if (items.length === 0) return <EmptyChart label={title} kind="donut" className={className} />;

  const percents = roundedPercents(items.map((item) => item.amount));
  const arcs = sliceAngles(items.map((item) => item.amount));
  const total = sumDecimals(items.map((item) => item.value));
  const colors = items.map((item, index) => chartColorVar(pickColor(item.color, index)));

  const biggest = items[0];
  // Com so o valor (o total, por exemplo) ele tambem entra no resumo: o texto do centro e aria-hidden
  const centerSummary = centerValue ? (centerLabel ? ` ${centerLabel}: ${centerValue}.` : ` ${centerValue}.`) : "";
  const summary =
    `${title}. ${items.length} ${items.length === 1 ? "fatia" : "fatias"}, total ${formatValue(total)}.` +
    ` Maior: ${biggest.label}, ${percentText(percents[0])}.${centerSummary}`;

  const sliceText = (index: number) => `${formatValue(items[index].value)} (${percentText(percents[index])})`;
  const active = activeIndex !== null && activeIndex < items.length ? activeIndex : null;
  const anchor = active !== null ? arcMidpoint(CENTER, CENTER, OUTER, arcs[active]) : null;

  return (
    <div data-chart="donut" className={cn("flex flex-col items-center gap-4 sm:flex-row", className)}>
      <div className="relative w-full max-w-56 shrink-0">
        <svg role="img" aria-label={summary} width="100%" viewBox={`0 0 ${SIZE} ${SIZE}`} className="block">
          {items.map((item, index) => (
            <path
              key={item.key}
              d={ringSlicePath(CENTER, CENTER, active === index ? OUTER_ACTIVE : OUTER, INNER, arcs[index].start, arcs[index].end)}
              data-slice={item.key}
              fillRule="evenodd"
              strokeWidth={2}
              className="stroke-card"
              style={{ fill: colors[index] }}
            />
          ))}
        </svg>

        <svg
          role="group"
          aria-label={`Fatias de ${title}`}
          width="100%"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="pointer-events-none absolute inset-0 block"
          onKeyDown={(event) => {
            if (event.key === "Escape") setActiveIndex(null);
          }}
        >
          {items.map((item, index) => (
            <path
              key={item.key}
              d={ringSlicePath(CENTER, CENTER, OUTER, INNER, arcs[index].start, arcs[index].end)}
              data-hit={item.key}
              fillRule="evenodd"
              tabIndex={0}
              aria-label={`${item.label}: ${sliceText(index)}`}
              className="pointer-events-auto cursor-pointer outline-none"
              fill="transparent"
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            />
          ))}
        </svg>

        {centerLabel || centerValue ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[22%] text-center"
          >
            {centerLabel ? <span className="text-xs text-muted-foreground">{centerLabel}</span> : null}
            {centerValue ? <span className="text-sm font-semibold tabular-nums break-words">{centerValue}</span> : null}
          </div>
        ) : null}

        {active !== null && anchor ? (
          <ChartTooltip
            leftPercent={round2((anchor.x / SIZE) * 100)}
            topPercent={round2((anchor.y / SIZE) * 100)}
            placement={tooltipPlacement(anchor.x, anchor.y, SIZE)}
          >
            <div className="text-muted-foreground">{items[active].label}</div>
            <div className="font-medium tabular-nums">{sliceText(active)}</div>
          </ChartTooltip>
        ) : null}
      </div>

      <ul aria-hidden="true" className="flex w-full min-w-0 flex-1 flex-col gap-1.5 text-sm">
        {items.map((item, index) => (
          <li key={item.key} data-legend={item.key} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: colors[index] }} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">{formatValue(item.value)}</span>
            <span className="w-10 text-right tabular-nums">{percentText(percents[index])}</span>
          </li>
        ))}
      </ul>

      <ChartTable
        caption={title}
        headers={["Categoria", "Valor", "Participação"]}
        rows={items.map((item, index) => ({
          header: item.label,
          cells: [formatValue(item.value), percentText(percents[index])],
        }))}
      />
    </div>
  );
}

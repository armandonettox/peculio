import { cn } from "@/lib/utils";
import { chartColorVar } from "./chart-colors";
import { parseDecimal, round2 } from "./chart-numbers";
import { ChartTable } from "./chart-parts";
import { linePath, sparklinePoints } from "./line-geometry";
import type { ChartColor, SparklineProps } from "./types";

const WIDTH = 120;
const HEIGHT = 32;
const PAD = 3;
const DOT_RADIUS = 2.5;

const TONE_COLOR: Record<NonNullable<SparklineProps["tone"]>, ChartColor> = {
  positive: "positive",
  negative: "negative",
  neutral: "muted",
};

/**
 * Linha minima, sem eixos nem tooltip, para caber ao lado de um numero. O desenho tem role img e a
 * tabela equivalente (sr-only) traz todos os valores. Sem dado, mostra um traco apagado.
 */
export function Sparkline({ label, values, tone = "neutral", formatValue = (value) => value, className }: SparklineProps) {
  const points = sparklinePoints(values.map(parseDecimal), WIDTH, HEIGHT, PAD);
  const color = chartColorVar(TONE_COLOR[tone] ?? "muted");
  const empty = values.length === 0;

  return (
    <span data-chart="sparkline" data-tone={tone} className={cn("inline-block h-8 w-28 align-middle", className)}>
      <svg
        role="img"
        aria-label={empty ? `${label}: sem dados` : label}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-full w-full"
      >
        {empty ? (
          <line
            x1={PAD}
            x2={WIDTH - PAD}
            y1={HEIGHT / 2}
            y2={HEIGHT / 2}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            data-empty="true"
            style={{ stroke: chartColorVar("muted") }}
          />
        ) : points.length === 1 ? (
          <circle cx={round2(points[0].x)} cy={round2(points[0].y)} r={DOT_RADIUS} style={{ fill: color }} />
        ) : (
          <>
            <path
              d={linePath(points)}
              data-line="true"
              fill="none"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ stroke: color }}
            />
            <circle
              cx={round2(points[points.length - 1].x)}
              cy={round2(points[points.length - 1].y)}
              r={DOT_RADIUS}
              style={{ fill: color }}
            />
          </>
        )}
      </svg>
      {empty ? null : (
        <ChartTable
          caption={label}
          headers={["Posição", "Valor"]}
          rows={values.map((value, index) => ({ header: String(index + 1), cells: [formatValue(value)] }))}
        />
      )}
    </span>
  );
}

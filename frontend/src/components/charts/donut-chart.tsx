import type { DonutChartProps } from "./types";

// Provisorio: o trilho dos graficos substitui por o desenho em SVG, mantendo as props
export function DonutChart({ title, className }: DonutChartProps) {
  return <div role="img" aria-label={title} data-chart="donut" data-stub className={className} />;
}

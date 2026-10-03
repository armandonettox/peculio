import type { LineChartProps } from "./types";

// Provisorio: o trilho dos graficos substitui por o desenho em SVG, mantendo as props
export function LineChart({ title, className }: LineChartProps) {
  return <div role="img" aria-label={title} data-chart="line" data-stub className={className} />;
}

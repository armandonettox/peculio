import type { SparklineProps } from "./types";

// Provisorio: o trilho dos graficos substitui por o desenho em SVG, mantendo as props
export function Sparkline({ label, className }: SparklineProps) {
  return <span role="img" aria-label={label} data-chart="sparkline" data-stub className={className} />;
}

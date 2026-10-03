/**
 * Contrato dos graficos do painel. Sao desenhados em SVG, sem biblioteca, com as cores da paleta pelos
 * tokens do tema. Valores sao SEMPRE texto decimal ("1234.50"): so a geometria converte para numero, e
 * o texto mostrado vem de `formatValue`. Todo grafico tem uma tabela equivalente para leitor de tela.
 *
 * Quem implementa pode acrescentar props OPCIONAIS; nao pode mudar nem remover as que estao aqui.
 */

// Nomes de cor da paleta (cada um mapeia para um token do tema, claro e escuro)
export type ChartColor = "primary" | "positive" | "negative" | "warning" | "muted" | "accent";

export type ChartPoint = {
  // "2026-03" (mes) ou "2026-03-15" (dia)
  x: string;
  // Texto decimal; pode ser negativo
  value: string;
};

export type LineSeries = {
  key: string;
  label: string;
  points: ChartPoint[];
  color?: ChartColor;
};

export type LineChartProps = {
  // Nome do grafico, lido por leitor de tela e usado como titulo da tabela equivalente
  title: string;
  description?: string;
  series: LineSeries[];
  // Texto de um valor ("R$ 1.234,50"); recebe o texto decimal
  formatValue: (value: string) => string;
  // Rotulo do eixo X ("mar/26"); recebe o `x` do ponto
  formatX: (x: string) => string;
  height?: number;
  className?: string;
};

export type DonutSlice = {
  key: string;
  label: string;
  // Texto decimal, sempre >= 0 (fatias negativas ou zeradas nao aparecem)
  value: string;
  color?: ChartColor;
};

export type DonutChartProps = {
  title: string;
  slices: DonutSlice[];
  formatValue: (value: string) => string;
  // Texto no centro da rosca (ex: o total)
  centerLabel?: string;
  centerValue?: string;
  // Acima disso, o resto vira uma fatia so
  maxSlices?: number;
  otherLabel?: string;
  className?: string;
};

export type SparklineProps = {
  // Descricao curta para leitor de tela ("Patrimonio nos ultimos 12 meses")
  label: string;
  // Texto decimal, do mais antigo ao mais recente
  values: string[];
  tone?: "positive" | "negative" | "neutral";
  className?: string;
};

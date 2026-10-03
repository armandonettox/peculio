// Escalas e marcas "bonitas" do eixo Y. Tudo puro e em numero.

export type NiceTicks = {
  // Valores das marcas, em ordem crescente (de 3 a 5)
  ticks: number[];
  min: number;
  max: number;
};

const MIN_TICKS = 3;
const MAX_TICKS = 5;
const NICE_MANTISSAS = [1, 2, 2.5, 5, 10];

// Remove o ruido de ponto flutuante (0.1 + 0.2) sem perder as casas que importam
function clean(value: number): number {
  return Number(value.toPrecision(12));
}

// Menor passo "bonito" (1, 2, 2.5, 5 vezes uma potencia de 10) que e >= ao passo bruto
export function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const base = 10 ** exponent;
  const mantissa = rawStep / base;
  const pick = NICE_MANTISSAS.find((candidate) => candidate >= mantissa - 1e-9) ?? 10;
  return clean(pick * base);
}

/**
 * Marcas do eixo Y para o intervalo [min, max]. Sempre de 3 a 5 marcas, cobrindo todos os valores.
 * Se ha valor negativo, o zero entra no intervalo (a linha do zero precisa existir). Intervalo sem
 * largura (tudo igual) ganha uma largura: tudo zero vai de 0 a 1; o resto inclui o zero.
 */
export function niceTicks(rawMin: number, rawMax: number): NiceTicks {
  let low = Number.isFinite(rawMin) ? rawMin : 0;
  let high = Number.isFinite(rawMax) ? rawMax : 0;
  if (low > high) [low, high] = [high, low];

  if (low === high) {
    if (low === 0) high = 1;
    else {
      const value = low;
      low = Math.min(0, value);
      high = Math.max(0, value);
    }
  }
  if (low < 0 && high < 0) high = 0;

  const range = high - low;
  let best: NiceTicks | null = null;
  let bestSpan = Infinity;
  for (const target of [5, 4, 3]) {
    const step = niceStep(range / (target - 1));
    const start = clean(Math.floor(low / step + 1e-9) * step);
    const end = clean(Math.ceil(high / step - 1e-9) * step);
    const count = Math.round((end - start) / step) + 1;
    if (count < MIN_TICKS || count > MAX_TICKS) continue;
    // Entre as opcoes validas, vence a que sobra menos area vazia (mais justa ao dado)
    if (end - start < bestSpan - 1e-12) {
      best = { ticks: Array.from({ length: count }, (_, i) => clean(start + i * step)), min: start, max: end };
      bestSpan = end - start;
    }
  }
  if (best) return best;

  // Sem combinacao boa: 3 marcas a partir de um passo que cobre o intervalo
  const step = niceStep(range / 2);
  const start = clean(Math.floor(low / step + 1e-9) * step);
  const ticks = [start, clean(start + step), clean(start + 2 * step)];
  return { ticks, min: ticks[0], max: ticks[2] };
}

// Escala linear: leva um valor do dominio para a faixa. Dominio sem largura cai no meio da faixa
export function linearScale(domainMin: number, domainMax: number, rangeStart: number, rangeEnd: number) {
  const span = domainMax - domainMin;
  return (value: number): number => {
    if (!Number.isFinite(span) || span === 0 || !Number.isFinite(value)) return (rangeStart + rangeEnd) / 2;
    return rangeStart + ((value - domainMin) / span) * (rangeEnd - rangeStart);
  };
}

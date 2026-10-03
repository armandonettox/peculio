// Numeros dos graficos. Os valores chegam como texto decimal; so a geometria converte para numero.

// Texto decimal para numero. Texto invalido ou fora do alcance (Infinity) vira 0, para o desenho nunca ter NaN
export function parseDecimal(text: string): number {
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Numero para texto decimal puro, sem notacao cientifica (1e21 viraria "1e+21" e quebraria o formatador)
export function toDecimalText(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 });
}

const DECIMAL_PATTERN = /^\s*([+-]?)(\d+)(?:\.(\d+))?\s*$/;

// Soma exata de textos decimais (sem float). Texto invalido conta como zero
export function sumDecimals(values: string[]): string {
  const parsed = values.flatMap((value) => {
    const match = DECIMAL_PATTERN.exec(value);
    return match ? [{ negative: match[1] === "-", whole: match[2], fraction: match[3] ?? "" }] : [];
  });
  const scale = parsed.reduce((top, item) => Math.max(top, item.fraction.length), 0);
  let total = 0n;
  for (const item of parsed) {
    const units = BigInt(item.whole + item.fraction.padEnd(scale, "0"));
    total += item.negative ? -units : units;
  }
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  const text = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}

// Arredonda para 2 casas e garante finito: usado nos atributos do SVG
export function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

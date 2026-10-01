// Cores escolhidas pelo usuario (ex: cor de uma categoria). Podem ser qualquer uma, entao o
// texto que fica por cima precisa se adaptar para continuar legivel.

/**
 * Le o que o usuario digitou e devolve "#RRGGBB" em maiusculas, ou null se nao for uma cor.
 * Aceita com ou sem "#" e a forma curta ("#abc" vira "#AABBCC").
 */
export function normalizeHex(input: string): string | null {
  const text = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return `#${[...text].map((digit) => digit + digit).join("")}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text}`.toUpperCase();
  return null;
}

function channel(hex: string, start: number): number {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

// Luminancia relativa (WCAG)
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const LIGHT_TEXT = "#FFFFFF";
// Preto puro de proposito: o melhor entre branco e preto sempre passa de 4,5 de contraste
// (o pior caso e um cinza medio, com cerca de 4,58). Com um "quase preto" isso nao se garante.
const DARK_TEXT = "#000000";

/** Branco ou preto, o que tiver mais contraste sobre o fundo informado. */
export function readableTextColor(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

// Atalhos do seletor. As tres primeiras sao a paleta do app; o usuario pode usar qualquer outra.
export const COLOR_SUGGESTIONS = [
  "#1E3A6B",
  "#00A878",
  "#01603B",
  "#E11D48",
  "#F59E0B",
  "#8B5CF6",
  "#0EA5E9",
  "#EC4899",
  "#64748B",
  "#171717",
] as const;

/** Erro de uma cor digitada, ou undefined se estiver vazia (sem cor) ou valida. */
export function colorError(text: string): string | undefined {
  if (text.trim() === "") return undefined;
  return normalizeHex(text) ? undefined : "Use o formato #RRGGBB, por exemplo #1E3A6B.";
}

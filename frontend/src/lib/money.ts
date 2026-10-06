import { currentIntlLocale, i18n } from "@/i18n";

// Dinheiro no frontend. A API manda e recebe valores como texto ("1234.50"). Aqui nunca se
// usa float para somar: a conta e feita em inteiros (BigInt) na menor unidade da moeda.

// Casas decimais por moeda quando a lista de moedas ainda nao chegou. O backend e a fonte.
const DEFAULT_PLACES: Record<string, number> = { JPY: 0 };

export function placesOf(currencyCode: string, known?: Record<string, number>): number {
  return known?.[currencyCode] ?? DEFAULT_PLACES[currencyCode] ?? 2;
}

export function formatMoney(value: string, currencyCode: string): string {
  try {
    // O Intl aceita o texto decimal direto, sem passar por float
    return new Intl.NumberFormat(currentIntlLocale(), { style: "currency", currency: currencyCode }).format(
      value as Intl.StringNumericLiteral,
    );
  } catch {
    // Moeda que o navegador nao conhece: mostra o valor puro com o codigo
    return `${value} ${currencyCode}`;
  }
}

// ---------- Aritmetica exata ----------

type Units = { negative: boolean; units: bigint };

function toUnits(value: string, places: number): Units {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`Valor monetario invalido: ${value}`);
  const [, sign, integer, fraction = ""] = match;
  const padded = fraction.padEnd(places, "0").slice(0, places);
  return { negative: sign === "-", units: BigInt(integer + padded) };
}

function fromSigned(total: bigint, places: number): string {
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(places + 1, "0");
  const integer = places === 0 ? digits : digits.slice(0, -places);
  const fraction = places === 0 ? "" : `.${digits.slice(-places)}`;
  return `${negative ? "-" : ""}${integer}${fraction}`;
}

export function sumMoney(values: string[], places: number): string {
  const total = values.reduce((sum, value) => {
    const { negative, units } = toUnits(value, places);
    return sum + (negative ? -units : units);
  }, 0n);
  return fromSigned(total, places);
}

export function negateMoney(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value === "0" || /^0\.0+$/.test(value) ? value : `-${value}`;
}

export function isNegativeMoney(value: string): boolean {
  return value.startsWith("-") && !/^-0(\.0+)?$/.test(value);
}

// ---------- Leitura do que o usuario digita ----------

export type ParsedMoney = { ok: true; value: string } | { ok: false; error: string };

const escapeRegex = (char: string) => char.replace(/[.,]/g, "\\$&");

/**
 * Converte o que o usuario digitou para o texto que a API espera ("1234.50"), no padrao do idioma da tela:
 *   portugues: "1.234,50", "1234,5", "12.5"   (ponto separa milhares, virgula separa os centavos)
 *   ingles:    "1,234.50", "1234.5", "12,5"   (virgula separa milhares, ponto separa os centavos)
 * O separador do outro idioma sozinho so vale como centavos quando vem seguido de 1 ou 2 digitos ("12.5" em portugues,
 * "12,5" em ingles). Um grupo de tres digitos ("1.234" em portugues, "1,234" em ingles) e lido como milhar, nunca como
 * 1,234.
 */
export function parseMoneyInput(raw: string, places: number, locale: string = currentIntlLocale()): ParsedMoney {
  const decimal = locale.toLowerCase().startsWith("pt") ? "," : ".";
  const group = decimal === "," ? "." : ",";
  const G = escapeRegex(group);
  const invalid = { ok: false, error: i18n.t("money.invalid") } as const;

  const text = raw.trim().replace(/\s/g, "");
  if (!text) return { ok: false, error: i18n.t("money.required") };

  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;

  let integer: string;
  let fraction = "";

  if (body.includes(decimal)) {
    const parts = body.split(decimal);
    if (parts.length !== 2) return invalid;
    integer = parts[0];
    fraction = parts[1];
    // Antes do separador de centavos, o outro so e aceito como separador de milhares (grupos de 3)
    if (integer.includes(group) && !new RegExp(`^\\d{1,3}(${G}\\d{3})+$`).test(integer)) return invalid;
    integer = integer.replaceAll(group, "");
  } else if (new RegExp(`^\\d+${G}\\d{1,2}$`).test(body)) {
    [integer, fraction] = body.split(group);
  } else if (new RegExp(`^\\d{1,3}(${G}\\d{3})+$`).test(body)) {
    integer = body.replaceAll(group, "");
  } else {
    integer = body;
  }

  if (!/^\d+$/.test(integer) || (fraction !== "" && !/^\d+$/.test(fraction))) return invalid;
  if (fraction.length > places) {
    return {
      ok: false,
      error: places === 0 ? i18n.t("money.noCents") : i18n.t("money.maxDecimals", { places }),
    };
  }
  integer = integer.replace(/^0+(?=\d)/, "");
  if (integer.length + places > 18) return { ok: false, error: i18n.t("money.tooLarge") };

  const canonical = `${integer}${places > 0 ? `.${fraction.padEnd(places, "0")}` : ""}`;
  return { ok: true, value: negative && !/^0(\.0+)?$/.test(canonical) ? `-${canonical}` : canonical };
}

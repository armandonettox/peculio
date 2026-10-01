// Dinheiro no frontend. A API manda e recebe valores como texto ("1234.50"). Aqui nunca se
// usa float para somar: a conta e feita em inteiros (BigInt) na menor unidade da moeda.

const LOCALE = "pt-BR";

// Casas decimais por moeda quando a lista de moedas ainda nao chegou. O backend e a fonte.
const DEFAULT_PLACES: Record<string, number> = { JPY: 0 };

export function placesOf(currencyCode: string, known?: Record<string, number>): number {
  return known?.[currencyCode] ?? DEFAULT_PLACES[currencyCode] ?? 2;
}

export function formatMoney(value: string, currencyCode: string): string {
  try {
    // O Intl aceita o texto decimal direto, sem passar por float
    return new Intl.NumberFormat(LOCALE, { style: "currency", currency: currencyCode }).format(
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

/**
 * Converte o que o usuario digitou ("1.234,50", "1234,5", "12.5") para o texto que a API
 * espera ("1234.50"). No Brasil o ponto separa milhares e a virgula separa os centavos.
 * Um ponto sozinho so vale como centavos quando vem seguido de 1 ou 2 digitos ("12.5"):
 * "1.234" e lido como mil duzentos e trinta e quatro, nunca como 1,234.
 */
export function parseMoneyInput(raw: string, places: number): ParsedMoney {
  const text = raw.trim().replace(/\s/g, "");
  if (!text) return { ok: false, error: "Informe o valor." };

  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;

  let integer: string;
  let fraction = "";

  if (body.includes(",")) {
    const parts = body.split(",");
    if (parts.length !== 2) return { ok: false, error: "Valor inválido." };
    integer = parts[0];
    fraction = parts[1];
    // Antes da virgula, o ponto so e aceito como separador de milhares (grupos de 3)
    if (integer.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(integer)) return { ok: false, error: "Valor inválido." };
    integer = integer.replaceAll(".", "");
  } else if (/^\d+\.\d{1,2}$/.test(body)) {
    [integer, fraction] = body.split(".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(body)) {
    integer = body.replaceAll(".", "");
  } else {
    integer = body;
  }

  if (!/^\d+$/.test(integer) || (fraction !== "" && !/^\d+$/.test(fraction))) {
    return { ok: false, error: "Valor inválido." };
  }
  if (fraction.length > places) {
    return {
      ok: false,
      error: places === 0 ? "Esta moeda não tem centavos." : `Use no máximo ${places} casas decimais.`,
    };
  }
  integer = integer.replace(/^0+(?=\d)/, "");
  if (integer.length + places > 18) return { ok: false, error: "Valor muito grande." };

  const canonical = `${integer}${places > 0 ? `.${fraction.padEnd(places, "0")}` : ""}`;
  return { ok: true, value: negative && !/^0(\.0+)?$/.test(canonical) ? `-${canonical}` : canonical };
}

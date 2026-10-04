import type { ApiToken, ApiTokenScope } from "@/api/api-tokens";
import { appDayOf } from "@/lib/app-clock";
import { daysBetween, formatDate } from "@/lib/dates";

// A partir de quantos dias para vencer a lista avisa
export const SOON_DAYS = 7;

/** Validade escolhida na criacao. "never" nao expira; o valor padrao e 90 dias. */
export const VALIDITY_OPTIONS = [
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias (sugerido)" },
  { value: "365", label: "1 ano" },
  { value: "never", label: "Nunca expira" },
] as const;

export const DEFAULT_VALIDITY = "90";

/** Dias para mandar ao servidor, ou null para nunca expirar. */
export function expiresInDays(validity: string): number | null {
  if (validity === "never") return null;
  const days = Number(validity);
  return Number.isInteger(days) && days > 0 ? days : null;
}

export const SCOPE_OPTIONS: { value: ApiTokenScope; label: string; description: string }[] = [
  { value: "read", label: "Só leitura", description: "Consulta tudo, mas não cria, edita nem exclui nada." },
  { value: "write", label: "Leitura e escrita", description: "Consulta e também cria, edita e exclui." },
];

export function scopeLabel(scope: ApiTokenScope): string {
  return scope === "write" ? "Leitura e escrita" : "Só leitura";
}

export type ExpiryState = "never" | "ok" | "soon" | "expired";
export type Expiry = { state: ExpiryState; text: string };

/** Situacao da validade, com o texto que a lista mostra. `today` e o dia do app ("AAAA-MM-DD"). */
export function expiryOf(token: Pick<ApiToken, "expires_at" | "expired">, today: string): Expiry {
  if (!token.expires_at) return { state: "never", text: "Nunca expira" };
  const day = appDayOf(token.expires_at);
  if (token.expired) return { state: "expired", text: `Venceu em ${formatDate(day)}` };
  const left = daysBetween(today, day);
  const date = `Vence em ${formatDate(day)}`;
  if (left > SOON_DAYS) return { state: "ok", text: date };
  const when = left <= 0 ? "hoje" : left === 1 ? "amanhã" : `em ${left} dias`;
  return { state: "soon", text: `${date} (${when})` };
}

export function lastUsedText(token: Pick<ApiToken, "last_used_at">): string {
  return token.last_used_at ? `Último uso: ${formatDate(appDayOf(token.last_used_at))}` : "Nunca usado";
}

/** O comeco do token como aparece na lista: o resto nao existe mais em lugar nenhum. */
export function prefixText(token: Pick<ApiToken, "prefix">): string {
  return `${token.prefix}…`;
}

/** Quantos tokens vencidos ou perto de vencer a lista tem (para o aviso no topo). */
export function needingAttention(tokens: Pick<ApiToken, "expires_at" | "expired">[], today: string): number {
  return tokens.filter((token) => {
    const state = expiryOf(token, today).state;
    return state === "expired" || state === "soon";
  }).length;
}

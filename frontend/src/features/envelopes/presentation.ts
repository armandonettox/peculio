import type { Envelope, EnvelopeGroup } from "@/api/envelopes";
import { parseMoneyInput } from "@/lib/money";

/** O sinal de um valor em texto ("-12.50", "0.00", "7"): -1, 0 ou 1. Sem converter para numero. */
export function signOf(value: string): -1 | 0 | 1 {
  const text = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return 0;
  if (/^-?0+(\.0+)?$/.test(text)) return 0;
  return text.startsWith("-") ? -1 : 1;
}

export type ToBudgetState = "negative" | "zero" | "positive";

/** Como mostrar o "A orcar": negativo e o aviso (distribuiu mais do que tem), zero e tudo distribuido. */
export function toBudgetState(group: Pick<EnvelopeGroup, "to_budget">): ToBudgetState {
  const sign = signOf(group.to_budget);
  return sign < 0 ? "negative" : sign === 0 ? "zero" : "positive";
}

export function toBudgetHint(state: ToBudgetState): string {
  if (state === "negative") return "Você distribuiu mais do que tem. Tire de algum envelope ou lance o que ainda vai entrar.";
  if (state === "zero") return "Tudo distribuído.";
  return "Dinheiro que ainda não está em nenhum envelope.";
}

/** A situacao do envelope no mes, sempre com texto (a cor nunca e a unica pista). */
export function availableState(envelope: Pick<Envelope, "available" | "overspent">): "overspent" | "empty" | "ok" {
  if (signOf(envelope.overspent) > 0) return "overspent";
  return signOf(envelope.available) === 0 ? "empty" : "ok";
}

export function availableLabel(state: ReturnType<typeof availableState>): string | null {
  if (state === "overspent") return "Estourou";
  if (state === "empty") return "Zerado";
  return null;
}

/** O que a pessoa digitou na distribuicao virou o valor a enviar, ou o motivo de nao servir. Vazio e zero (limpa). */
export function parseAllocation(text: string, places: number): { ok: true; value: string } | { ok: false; error: string } {
  if (text.trim() === "") return { ok: true, value: "0" };
  const parsed = parseMoneyInput(text, places);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, error: parsed.error };
}

/** Texto de um valor para o campo: ponto vira virgula. */
export const toInputText = (value: string): string => value.replace(".", ",");

/** AAAA-MM do primeiro dia do mes ("2026-03-01" -> "2026-03"). */
export const monthParam = (month: string): string => month.slice(0, 7);

/** Os envelopes que podem dar dinheiro a outro (tem algo disponivel), para a lista de origem do "Mover". */
export function givers(group: Pick<EnvelopeGroup, "envelopes">): Envelope[] {
  return group.envelopes.filter((envelope) => signOf(envelope.available) > 0);
}

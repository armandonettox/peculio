import type { Account } from "@/api/accounts";
import { placesOf, sumMoney } from "@/lib/money";

export type CurrencyTotal = { currency: string; total: string };

/**
 * Soma os saldos por moeda: real com real, dolar com dolar. Moedas diferentes nao se
 * somam sem cotacao. Contas arquivadas ficam de fora.
 */
export function totalsByCurrency(accounts: Account[], knownPlaces?: Record<string, number>): CurrencyTotal[] {
  const byCurrency = new Map<string, string[]>();
  for (const account of accounts) {
    if (!account.active) continue;
    byCurrency.set(account.currency_code, [...(byCurrency.get(account.currency_code) ?? []), account.balance]);
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, balances]) => ({ currency, total: sumMoney(balances, placesOf(currency, knownPlaces)) }));
}

import { i18n } from "@/i18n";
import type { Transaction, TransactionSplit } from "@/api/transactions";
import { formatDayHeading, appToday } from "@/lib/dates";
import { formatMoney, negateMoney, placesOf, sumMoney } from "@/lib/money";

// Regras de como um lancamento aparece na lista: sentido do dinheiro, rotulos e agrupamento.

/** out: dinheiro saiu (saque e pagamento de divida); in: entrou; neutral: so mudou de conta. */
export type Direction = "out" | "in" | "neutral";

export function directionOf(split: Pick<TransactionSplit, "type">): Direction {
  if (split.type === "withdrawal") return "out";
  if (split.type === "deposit") return "in";
  return "neutral";
}

/** A outra ponta do lancamento: o destino do saque, a origem do deposito, "A → B" na transferencia. */
export function counterpartyLabel(split: TransactionSplit): string {
  if (split.type === "withdrawal") return split.destination_account_name;
  if (split.type === "deposit") return split.source_account_name;
  return `${split.source_account_name} → ${split.destination_account_name}`;
}

/** A conta do usuario envolvida. Na transferencia sao duas, e ja aparecem no rotulo da contraparte. */
export function ownAccountName(split: TransactionSplit): string | null {
  if (split.type === "withdrawal") return split.source_account_name;
  if (split.type === "deposit") return split.destination_account_name;
  return null;
}

function signed(value: string, currency: string, direction: Direction): string {
  const text = formatMoney(direction === "out" ? negateMoney(value) : value, currency);
  return direction === "in" ? `+${text}` : text;
}

/** "-R$ 50,00" na saida, "+R$ 300,00" na entrada, "R$ 100,00" na transferencia. */
export function formatSplitAmount(split: TransactionSplit): string {
  const main = signed(split.amount, split.currency_code, directionOf(split));
  // Transferencia entre moedas: mostra quanto saiu e quanto chegou
  if (split.type === "transfer" && split.foreign_amount && split.foreign_currency_code) {
    return `${main} → ${formatMoney(split.foreign_amount, split.foreign_currency_code)}`;
  }
  return main;
}

/** Valor original quando a compra foi feita em outra moeda e paga na moeda da conta. */
export function foreignNote(split: TransactionSplit): string | null {
  if (split.type === "transfer" || !split.foreign_amount || !split.foreign_currency_code) return null;
  return i18n.t("transactions.presentation.originalAmount", { amount: formatMoney(split.foreign_amount, split.foreign_currency_code) });
}

export function transactionTitle(transaction: Transaction): string {
  return transaction.title || transaction.splits[0]?.description || i18n.t("transactions.presentation.noDescription");
}

/** A data do lancamento: a mais recente entre os splits (a mesma usada na ordem da lista). */
export function transactionDate(transaction: Transaction): string {
  return transaction.splits.reduce((latest, split) => (split.date > latest ? split.date : latest), "");
}

/**
 * Valor do grupo: o do split unico ou a soma dos splits. Devolve null quando os splits nao
 * somam de forma honesta (sentidos ou moedas diferentes); a tela mostra cada linha.
 */
export function formatTransactionAmount(transaction: Transaction): string | null {
  const [first] = transaction.splits;
  if (!first) return null;
  // Um split so nunca precisa somar: mostra o valor dele (inclusive "R$ 500 → US$ 100" numa
  // transferencia entre moedas)
  if (transaction.splits.length === 1) return formatSplitAmount(first);
  const direction = directionOf(first);
  const sameKind = transaction.splits.every(
    (split) =>
      directionOf(split) === direction &&
      split.currency_code === first.currency_code &&
      !(split.type === "transfer" && split.foreign_amount),
  );
  if (!sameKind) return null;

  const total = sumMoney(
    transaction.splits.map((split) => split.amount),
    placesOf(first.currency_code),
  );
  return signed(total, first.currency_code, direction);
}

export type DayGroup = { date: string; label: string; items: Transaction[] };

/**
 * Agrupa por dia mantendo a ordem que a API mandou (mais recente primeiro). Funciona com a
 * lista de todas as paginas juntas: um dia que continua na pagina seguinte nao se divide em dois.
 */
export function groupByDay(transactions: Transaction[], today: string = appToday()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const transaction of transactions) {
    const date = transactionDate(transaction);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.items.push(transaction);
    else groups.push({ date, label: formatDayHeading(date, today), items: [transaction] });
  }
  return groups;
}

export type ReconciliationState = "locked" | "cleared" | null;

/** Travado (conciliacao fechada) vale mais que conferido; sem nenhum dos dois, nao ha marca. */
export function reconciliationState(transaction: Transaction): ReconciliationState {
  if (transaction.splits.some((split) => split.locked)) return "locked";
  if (transaction.splits.some((split) => split.cleared)) return "cleared";
  return null;
}

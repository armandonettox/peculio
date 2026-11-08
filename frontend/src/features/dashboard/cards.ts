// Quais blocos o painel mostra e em que coluna. A escolha fica so neste navegador (localStorage), como a
// visao Lista/Tabela das transacoes: e preferencia de tela, nao dado da conta.

export const LEFT_CARDS = [
  "expensesByCategory",
  "spendingFrequency",
  "monthlyBalance",
  "pendingTransactions",
  "budgetSummary",
  "favorites",
  "calendar",
  "accounts",
  "upcoming",
  "recentTransactions",
] as const;

export const RIGHT_CARDS = [
  "incomeByCategory",
  "semesterBalance",
  "quarterBalance",
  "creditCards",
  "goals",
  "savings",
  "profile",
  "netWorth",
] as const;

export type DashboardCardId = (typeof LEFT_CARDS)[number] | (typeof RIGHT_CARDS)[number];

// Ligados de fabrica: o que o painel ja mostrava antes mais o que o Mobills liga por padrao
const DEFAULT_ON: DashboardCardId[] = [
  "expensesByCategory",
  "monthlyBalance",
  "budgetSummary",
  "upcoming",
  "recentTransactions",
  "incomeByCategory",
  "creditCards",
  "goals",
  "netWorth",
];

const STORAGE_KEY = "peculio.dashboard.cards";

const ALL_CARDS: readonly string[] = [...LEFT_CARDS, ...RIGHT_CARDS];

export function defaultCards(): DashboardCardId[] {
  return [...DEFAULT_ON];
}

/** Os blocos ligados. Sem escolha salva (ou com valor ilegivel), vale o padrao. */
export function readEnabledCards(): DashboardCardId[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCards();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultCards();
    // Nome que nao existe mais (bloco removido numa versao nova) e ignorado
    return parsed.filter((item): item is DashboardCardId => typeof item === "string" && ALL_CARDS.includes(item));
  } catch {
    return defaultCards();
  }
}

export function writeEnabledCards(cards: DashboardCardId[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // Sem armazenamento (janela privada, dados bloqueados): a escolha vale so ate fechar a pagina
  }
}

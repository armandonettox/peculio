// Quais blocos o painel mostra, em que coluna e em que ordem. A escolha fica so neste navegador
// (localStorage), como a visao Lista/Tabela das transacoes: e preferencia de tela, nao dado da conta.

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

export type DashboardColumn = "left" | "right";

export type DashboardLayout = {
  // Os blocos ligados
  enabled: DashboardCardId[];
  // A ordem de todos os blocos (ligados ou nao): os da esquerda e depois os da direita
  order: DashboardCardId[];
};

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

const STORAGE_KEY = "peculio.dashboard.layout";
// Versao anterior: so guardava a lista de blocos ligados, sem ordem
const LEGACY_KEY = "peculio.dashboard.cards";

const ALL_CARDS: readonly DashboardCardId[] = [...LEFT_CARDS, ...RIGHT_CARDS];

export function columnCards(column: DashboardColumn): readonly DashboardCardId[] {
  return column === "left" ? LEFT_CARDS : RIGHT_CARDS;
}

export function defaultLayout(): DashboardLayout {
  return { enabled: [...DEFAULT_ON], order: [...ALL_CARDS] };
}

function isCardId(value: unknown): value is DashboardCardId {
  return typeof value === "string" && (ALL_CARDS as readonly string[]).includes(value);
}

function validIds(value: unknown): DashboardCardId[] | null {
  if (!Array.isArray(value)) return null;
  // Nome que nao existe mais (bloco removido numa versao nova) e repeticao sao ignorados
  return value.filter(isCardId).filter((id, index, list) => list.indexOf(id) === index);
}

// Completa a ordem salva com os blocos que ela nao conhece (bloco criado numa versao nova), no fim da coluna dele
function completeOrder(saved: DashboardCardId[]): DashboardCardId[] {
  const column = (cards: readonly DashboardCardId[]) => [...saved.filter((id) => cards.includes(id)), ...cards.filter((id) => !saved.includes(id))];
  return [...column(LEFT_CARDS), ...column(RIGHT_CARDS)];
}

/** A escolha salva. Sem nada salvo (ou com valor ilegivel), vale o padrao. */
export function readLayout(): DashboardLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const enabled = validIds((parsed as { enabled?: unknown } | null)?.enabled);
      const order = validIds((parsed as { order?: unknown } | null)?.order);
      if (enabled && order) return { enabled, order: completeOrder(order) };
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const enabled = validIds(JSON.parse(legacy));
      if (enabled) return { ...defaultLayout(), enabled };
    }
  } catch {
    // Valor ilegivel: cai no padrao
  }
  return defaultLayout();
}

export function writeLayout(layout: DashboardLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Sem armazenamento (janela privada, dados bloqueados): a escolha vale so ate fechar a pagina
  }
}

/** Os blocos de uma coluna, na ordem escolhida. */
export function orderedColumn(order: DashboardCardId[], column: DashboardColumn): DashboardCardId[] {
  const cards = columnCards(column);
  return order.filter((id) => cards.includes(id));
}

/** Leva o bloco para a posicao de outro da mesma coluna, que e como o Mobills solta a linha arrastada. */
export function moveCard(order: DashboardCardId[], id: DashboardCardId, targetId: DashboardCardId): DashboardCardId[] {
  const column: DashboardColumn = LEFT_CARDS.includes(id as (typeof LEFT_CARDS)[number]) ? "left" : "right";
  const ids = orderedColumn(order, column);
  const from = ids.indexOf(id);
  const to = ids.indexOf(targetId);
  // Alvo de outra coluna ou o proprio bloco: nada muda
  if (from < 0 || to < 0 || from === to) return order;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  return column === "left" ? [...ids, ...orderedColumn(order, "right")] : [...orderedColumn(order, "left"), ...ids];
}

/** Sobe (-1) ou desce (+1) o bloco uma posicao dentro da coluna; no limite da coluna nao muda nada. */
export function moveCardBy(order: DashboardCardId[], id: DashboardCardId, delta: -1 | 1): DashboardCardId[] {
  const column: DashboardColumn = LEFT_CARDS.includes(id as (typeof LEFT_CARDS)[number]) ? "left" : "right";
  const ids = orderedColumn(order, column);
  const target = ids[ids.indexOf(id) + delta];
  return target ? moveCard(order, id, target) : order;
}

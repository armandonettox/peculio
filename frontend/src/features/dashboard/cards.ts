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
  // Os blocos de cada coluna, na ordem em que aparecem (ligados ou nao). Cada bloco esta em uma coluna so.
  left: DashboardCardId[];
  right: DashboardCardId[];
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

export function defaultLayout(): DashboardLayout {
  return { enabled: [...DEFAULT_ON], left: [...LEFT_CARDS], right: [...RIGHT_CARDS] };
}

function isCardId(value: unknown): value is DashboardCardId {
  return typeof value === "string" && (ALL_CARDS as readonly string[]).includes(value);
}

function validIds(value: unknown): DashboardCardId[] | null {
  if (!Array.isArray(value)) return null;
  // Nome que nao existe mais (bloco removido numa versao nova) e repeticao sao ignorados
  return value.filter(isCardId).filter((id, index, list) => list.indexOf(id) === index);
}

/**
 * Monta as duas colunas a partir do que foi salvo: um bloco que aparece nas duas fica so na da esquerda, e um
 * bloco que a escolha salva nao conhece (criado numa versao nova) entra no fim da coluna de fabrica dele.
 */
function completeColumns(left: DashboardCardId[], right: DashboardCardId[]): Pick<DashboardLayout, "left" | "right"> {
  const placedRight = right.filter((id) => !left.includes(id));
  const placed = [...left, ...placedRight];
  const missing = ALL_CARDS.filter((id) => !placed.includes(id));
  return {
    left: [...left, ...missing.filter((id) => (LEFT_CARDS as readonly string[]).includes(id))],
    right: [...placedRight, ...missing.filter((id) => (RIGHT_CARDS as readonly string[]).includes(id))],
  };
}

/** A escolha salva. Sem nada salvo (ou com valor ilegivel), vale o padrao. */
export function readLayout(): DashboardLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { enabled?: unknown; left?: unknown; right?: unknown; order?: unknown } | null;
      const enabled = validIds(parsed?.enabled);
      const left = validIds(parsed?.left);
      const right = validIds(parsed?.right);
      if (enabled && left && right) return { enabled, ...completeColumns(left, right) };
      // Formato anterior: uma ordem so, com os blocos presos a coluna de fabrica
      const order = validIds(parsed?.order);
      if (enabled && order) {
        return {
          enabled,
          ...completeColumns(
            order.filter((id) => (LEFT_CARDS as readonly string[]).includes(id)),
            order.filter((id) => (RIGHT_CARDS as readonly string[]).includes(id)),
          ),
        };
      }
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

export function columnOf(layout: DashboardLayout, id: DashboardCardId): DashboardColumn {
  return layout.left.includes(id) ? "left" : "right";
}

/**
 * Leva o bloco para a posicao de outro: na mesma coluna ele toma o lugar do alvo (como o Mobills solta a linha
 * arrastada); numa coluna diferente ele entra na coluna do alvo, na posicao do alvo.
 */
export function moveCard(layout: DashboardLayout, id: DashboardCardId, targetId: DashboardCardId): DashboardLayout {
  if (id === targetId) return layout;
  const from = columnOf(layout, id);
  const to = columnOf(layout, targetId);
  const source = [...layout[from]];
  source.splice(source.indexOf(id), 1);
  // Na mesma coluna a lista de destino e a que ja perdeu o bloco; na outra, e a da coluna do alvo.
  // A posicao e sempre a que o alvo tinha antes: o bloco toma o lugar dele.
  const target = from === to ? source : [...layout[to]];
  target.splice(layout[to].indexOf(targetId), 0, id);
  return from === to ? { ...layout, [from]: target } : { ...layout, [from]: source, [to]: target };
}

/** Leva o bloco para o fim de uma coluna (soltar numa coluna vazia ou abaixo do ultimo bloco). */
export function moveCardToColumn(layout: DashboardLayout, id: DashboardCardId, column: DashboardColumn): DashboardLayout {
  const from = columnOf(layout, id);
  const source = layout[from].filter((item) => item !== id);
  if (from === column) return { ...layout, [column]: [...source, id] };
  return { ...layout, [from]: source, [column]: [...layout[column], id] };
}

/** Sobe (-1) ou desce (+1) o bloco uma posicao dentro da coluna; no limite da coluna nao muda nada. */
export function moveCardBy(layout: DashboardLayout, id: DashboardCardId, delta: -1 | 1): DashboardLayout {
  const ids = layout[columnOf(layout, id)];
  const target = ids[ids.indexOf(id) + delta];
  return target ? moveCard(layout, id, target) : layout;
}

/** Passa o bloco para a outra coluna, no fim dela (o equivalente de arrastar pelo teclado). */
export function moveCardToOtherColumn(layout: DashboardLayout, id: DashboardCardId): DashboardLayout {
  return moveCardToColumn(layout, id, columnOf(layout, id) === "left" ? "right" : "left");
}

// ---------- Lista unica (celular) ----------
// No celular o painel mostra uma coluna so, a da esquerda e depois a da direita. A tela de configuracoes mostra
// essa mesma lista, sem colunas: reordenar mexe na lista inteira e a divisao entre as colunas do desktop continua
// com o mesmo tamanho (os primeiros N da lista ficam na esquerda).

export function flatCards(layout: DashboardLayout): DashboardCardId[] {
  return [...layout.left, ...layout.right];
}

function splitFlat(layout: DashboardLayout, flat: DashboardCardId[]): DashboardLayout {
  const size = layout.left.length;
  return { ...layout, left: flat.slice(0, size), right: flat.slice(size) };
}

/** Leva o bloco para o lugar de outro na lista unica. */
export function moveFlat(layout: DashboardLayout, id: DashboardCardId, targetId: DashboardCardId): DashboardLayout {
  const flat = flatCards(layout);
  const from = flat.indexOf(id);
  const to = flat.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return layout;
  flat.splice(to, 0, flat.splice(from, 1)[0]);
  return splitFlat(layout, flat);
}

/** Sobe (-1) ou desce (+1) o bloco uma posicao na lista unica; nas pontas da lista nao muda nada. */
export function moveFlatBy(layout: DashboardLayout, id: DashboardCardId, delta: -1 | 1): DashboardLayout {
  const flat = flatCards(layout);
  const target = flat[flat.indexOf(id) + delta];
  return target ? moveFlat(layout, id, target) : layout;
}

/** Leva o bloco para o fim da lista unica. */
export function moveFlatToEnd(layout: DashboardLayout, id: DashboardCardId): DashboardLayout {
  const flat = flatCards(layout).filter((item) => item !== id);
  return splitFlat(layout, [...flat, id]);
}

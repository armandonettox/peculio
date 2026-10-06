import { i18n } from "@/i18n";
// A selecao de lancamentos da tabela, sem tela: quais estao marcados, o ancora do intervalo e os textos do contador. Fica
// aqui, com testes, e a tabela so a usa. A selecao vale so para o que esta carregado na tela.

// O teto de lancamentos por acao em massa; o servidor recusa mais que isso
export const BULK_MAX = 200;

export type Selection = { ids: ReadonlySet<string>; anchor: string | null };

export const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null };

/** Marca ou desmarca um lancamento. Ele vira o ancora do proximo intervalo (Shift+Espaco). */
export function toggle(selection: Selection, id: string): Selection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id };
}

/**
 * Marca do ancora ate `id`, na ordem da lista, somando ao que ja estava marcado. Sem ancora (ou com um ancora que saiu
 * da lista), marca so `id`.
 */
export function selectRange(selection: Selection, id: string, order: readonly string[]): Selection {
  const to = order.indexOf(id);
  const from = selection.anchor === null ? -1 : order.indexOf(selection.anchor);
  if (to === -1) return selection;
  if (from === -1) return { ids: new Set([...selection.ids, id]), anchor: id };
  const [start, end] = from <= to ? [from, to] : [to, from];
  return { ids: new Set([...selection.ids, ...order.slice(start, end + 1)]), anchor: id };
}

/** Ctrl+A: marca todos os carregados; se ja estao todos marcados, desmarca tudo. */
export function toggleAll(selection: Selection, order: readonly string[]): Selection {
  if (order.length === 0) return selection;
  const all = order.every((id) => selection.ids.has(id));
  return all ? EMPTY_SELECTION : { ids: new Set(order), anchor: selection.anchor };
}

/** Tira da selecao o que saiu da lista (excluido, filtrado fora) e o ancora que saiu junto. */
export function prune(selection: Selection, order: readonly string[]): Selection {
  const present = new Set(order);
  const kept = [...selection.ids].filter((id) => present.has(id));
  const anchor = selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null;
  if (kept.length === selection.ids.size && anchor === selection.anchor) return selection;
  return { ids: new Set(kept), anchor };
}

/** Os marcados, na ordem da lista (e nao na ordem em que foram marcados), prontos para mandar ao servidor. */
export function selectedInOrder(selection: Selection, order: readonly string[]): string[] {
  return order.filter((id) => selection.ids.has(id));
}

export const overLimit = (count: number) => count > BULK_MAX;

/** O contador: quantos marcados e, se ha mais por carregar, um aviso de que a selecao so pega o que esta na tela. */
export function selectionSummary(count: number, loaded: number, total: number): string {
  const marked = i18n.t("transactions.selection.selected", { count });
  if (total > loaded) return i18n.t("transactions.selection.selectedPartial", { marked, loaded, more: total - loaded });
  return marked;
}

/** Aviso quando a selecao passa do teto de uma acao; null se esta dentro. */
export function limitMessage(count: number): string | null {
  return overLimit(count) ? i18n.t("transactions.selection.limit", { max: BULK_MAX, count }) : null;
}

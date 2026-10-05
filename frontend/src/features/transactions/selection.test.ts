import { describe, expect, it } from "vitest";

import {
  BULK_MAX,
  EMPTY_SELECTION,
  limitMessage,
  overLimit,
  prune,
  selectedInOrder,
  selectionSummary,
  selectRange,
  toggle,
  toggleAll,
  type Selection,
} from "./selection";

const order = ["a", "b", "c", "d", "e"];
const of = (ids: string[], anchor: string | null = null): Selection => ({ ids: new Set(ids), anchor });
const ids = (selection: Selection) => [...selection.ids].sort();

describe("toggle", () => {
  it("marca, e o lancamento vira o ancora", () => {
    const next = toggle(EMPTY_SELECTION, "b");
    expect(ids(next)).toEqual(["b"]);
    expect(next.anchor).toBe("b");
  });

  it("marcar de novo desmarca, e o ancora continua sendo ele", () => {
    const next = toggle(of(["b", "c"], "c"), "c");
    expect(ids(next)).toEqual(["b"]);
    expect(next.anchor).toBe("c");
  });

  it("nao altera a selecao de antes", () => {
    const before = of(["a"], "a");
    toggle(before, "b");
    expect(ids(before)).toEqual(["a"]);
  });
});

describe("selectRange", () => {
  it.each([
    ["para baixo", of(["b"], "b"), "d", ["b", "c", "d"]],
    ["para cima", of(["d"], "d"), "b", ["b", "c", "d"]],
    ["no proprio ancora", of(["c"], "c"), "c", ["c"]],
    ["soma ao que ja estava", of(["a", "c"], "c"), "e", ["a", "c", "d", "e"]],
  ])("%s", (_name, start, to, expected) => {
    const next = selectRange(start, to, order);
    expect(ids(next)).toEqual(expected);
    expect(next.anchor).toBe(to);
  });

  it("sem ancora marca so o lancamento", () => {
    expect(ids(selectRange(EMPTY_SELECTION, "c", order))).toEqual(["c"]);
  });

  it("com o ancora fora da lista marca so o lancamento", () => {
    expect(ids(selectRange(of(["z"], "z"), "c", order))).toEqual(["c", "z"]);
  });

  it("lancamento fora da lista nao muda nada", () => {
    const before = of(["a"], "a");
    expect(selectRange(before, "z", order)).toBe(before);
  });
});

describe("toggleAll", () => {
  it("marca todos os carregados", () => {
    expect(ids(toggleAll(EMPTY_SELECTION, order))).toEqual(order);
  });

  it("marca os que faltam quando so alguns estavam marcados", () => {
    expect(ids(toggleAll(of(["a"], "a"), order))).toEqual(order);
  });

  it("com todos marcados, desmarca tudo e solta o ancora", () => {
    const next = toggleAll(of(order, "c"), order);
    expect(ids(next)).toEqual([]);
    expect(next.anchor).toBeNull();
  });

  it("lista vazia nao faz nada", () => {
    expect(toggleAll(EMPTY_SELECTION, [])).toBe(EMPTY_SELECTION);
  });

  it("mantem o ancora ao marcar todos", () => {
    expect(toggleAll(of(["b"], "b"), order).anchor).toBe("b");
  });
});

describe("prune", () => {
  it("tira o que saiu da lista", () => {
    const next = prune(of(["a", "b", "x"], "b"), ["a", "b", "c"]);
    expect(ids(next)).toEqual(["a", "b"]);
    expect(next.anchor).toBe("b");
  });

  it("solta o ancora que saiu", () => {
    expect(prune(of(["a"], "x"), ["a", "b"]).anchor).toBeNull();
  });

  it("sem mudanca devolve a mesma selecao", () => {
    const same = of(["a", "b"], "a");
    expect(prune(same, ["a", "b", "c"])).toBe(same);
  });

  it("lista vazia limpa tudo", () => {
    expect(ids(prune(of(["a"], "a"), []))).toEqual([]);
  });
});

describe("selectedInOrder", () => {
  it("segue a ordem da lista, nao a da marcacao", () => {
    const marked = toggle(toggle(toggle(EMPTY_SELECTION, "d"), "a"), "c");
    expect(selectedInOrder(marked, order)).toEqual(["a", "c", "d"]);
  });

  it("ignora o que nao esta na lista", () => {
    expect(selectedInOrder(of(["a", "x"]), order)).toEqual(["a"]);
  });
});

describe("limite e textos", () => {
  it("o teto e 200", () => {
    expect(BULK_MAX).toBe(200);
    expect(overLimit(200)).toBe(false);
    expect(overLimit(201)).toBe(true);
    expect(limitMessage(200)).toBeNull();
    expect(limitMessage(201)).toBe("Selecione no máximo 200 lançamentos por vez (há 201 marcados).");
  });

  it.each([
    [1, 25, 25, "1 selecionado"],
    [12, 25, 25, "12 selecionados"],
    [0, 25, 25, "0 selecionados"],
    [25, 25, 90, "25 selecionados (só os 25 carregados; há mais 65 por carregar)"],
    [3, 25, 26, "3 selecionados (só os 25 carregados; há mais 1 por carregar)"],
  ])("contador de %i (carregados %i, total %i)", (count, loaded, total, expected) => {
    expect(selectionSummary(count, loaded, total)).toBe(expected);
  });
});

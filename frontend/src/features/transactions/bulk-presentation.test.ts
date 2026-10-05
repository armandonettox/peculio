import { describe, expect, it } from "vitest";

import { bulkNotice, entriesText, lockedSummary } from "./bulk-presentation";

describe("entriesText", () => {
  it.each([
    [1, "1 lançamento"],
    [2, "2 lançamentos"],
    [200, "200 lançamentos"],
  ])("%i", (count, expected) => expect(entriesText(count)).toBe(expected));
});

describe("bulkNotice", () => {
  it.each([
    ["set_category", 1, false, "Categoria mudada em 1 lançamento."],
    ["set_category", 3, false, "Categoria mudada em 3 lançamentos."],
    ["set_category", 1, true, "Categoria removida de 1 lançamento."],
    ["set_category", 4, true, "Categoria removida de 4 lançamentos."],
    ["set_date", 1, false, "Data mudada em 1 lançamento."],
    ["set_date", 7, false, "Data mudada em 7 lançamentos."],
    ["duplicate", 1, false, "1 lançamento duplicado com a data de hoje."],
    ["duplicate", 5, false, "5 lançamentos duplicados com a data de hoje."],
    ["delete", 1, false, "1 lançamento excluído."],
    ["delete", 9, false, "9 lançamentos excluídos."],
  ] as const)("%s com %i (sem categoria: %s)", (action, count, cleared, expected) => {
    expect(bulkNotice(action, count, cleared)).toBe(expected);
  });

  it("o padrao de categoria e trocar, nao tirar", () => {
    expect(bulkNotice("set_category", 2)).toBe("Categoria mudada em 2 lançamentos.");
  });
});

describe("lockedSummary", () => {
  it("lista todos quando sao poucos", () => {
    expect(lockedSummary(["A"])).toBe("A");
    expect(lockedSummary(["A", "B", "C"])).toBe("A, B, C");
    expect(lockedSummary(["A", "B", "C", "D", "E"])).toBe("A, B, C, D, E");
  });

  it("corta em cinco e conta o resto", () => {
    expect(lockedSummary(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C, D, E e mais 1");
    expect(lockedSummary(["A", "B", "C", "D", "E", "F", "G", "H"])).toBe("A, B, C, D, E e mais 3");
  });

  it("sem travados, texto vazio", () => {
    expect(lockedSummary([])).toBe("");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { kindLabel, roleLabel } from "@/features/accounts/labels";
import { i18n } from "@/i18n";
import { bulkNotice, entriesText, lockedSummary } from "./bulk-presentation";
import { dateRangeError } from "./filters";
import { kindHint } from "./quick-row";
import { limitMessage, selectionSummary } from "./selection";
import { shortcutGroups } from "./table-nav";

// A logica de lancamentos no idioma ingles: textos, plurais, o zero e as teclas.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("selecao", () => {
  it("contador no singular, plural e zero", () => {
    expect(selectionSummary(1, 25, 25)).toBe("1 selected");
    expect(selectionSummary(3, 25, 25)).toBe("3 selected");
    expect(selectionSummary(0, 25, 25)).toBe("0 selected");
  });

  it("avisa quando ha mais por carregar", () => {
    expect(selectionSummary(30, 30, 80)).toBe("30 selected (only the 30 loaded; 50 more to load)");
  });

  it("limite de uma vez", () => {
    expect(limitMessage(500)).toMatch(/^Select at most \d+ transactions at a time \(500 are selected\)\.$/);
    expect(limitMessage(1)).toBeNull();
  });

  it("em portugues o zero e plural, apesar da regra do idioma", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(selectionSummary(0, 25, 25)).toBe("0 selecionados");
    expect(selectionSummary(1, 25, 25)).toBe("1 selecionado");
    expect(selectionSummary(2, 25, 25)).toBe("2 selecionados");
  });
});

describe("acoes em massa", () => {
  it("avisos de sucesso com plural", () => {
    expect(entriesText(1)).toBe("1 transaction");
    expect(entriesText(4)).toBe("4 transactions");
    expect(bulkNotice("set_category", 2)).toBe("Category changed on 2 transactions.");
    expect(bulkNotice("set_category", 1, true)).toBe("Category removed from 1 transaction.");
    expect(bulkNotice("set_date", 3)).toBe("Date changed on 3 transactions.");
    expect(bulkNotice("duplicate", 1)).toBe("1 transaction duplicated with today's date.");
    expect(bulkNotice("duplicate", 5)).toBe("5 transactions duplicated with today's date.");
    expect(bulkNotice("delete", 1)).toBe("1 transaction deleted.");
    expect(bulkNotice("delete", 2)).toBe("2 transactions deleted.");
  });

  it("resumo dos travados", () => {
    expect(lockedSummary(["A", "B"])).toBe("A, B");
    expect(lockedSummary(["A", "B", "C", "D", "E", "F", "G"])).toBe("A, B, C, D, E and 2 more");
  });
});

describe("outros textos", () => {
  it("filtro de datas, dica de tipo e papeis de conta", () => {
    expect(dateRangeError({ dateFrom: "2026-03-10", dateTo: "2026-03-01" } as never)).toBe("The start date is after the end date.");
    expect(kindHint("-10")).toBe("Expense");
    expect(kindHint("10")).toBe("Income");
    expect(roleLabel("checking")).toBe("Checking account");
    expect(roleLabel("credit_card")).toBe("Credit card");
    expect(kindLabel("liability")).toBe("Debt");
  });
});

describe("atalhos do teclado", () => {
  it("grupos em ingles, e a tecla Espaco vira Space", () => {
    const groups = shortcutGroups();
    expect(groups.map((group) => group.title)).toEqual([
      "With focus on a table row",
      "Select several transactions",
      "In the entry or edit row",
    ]);
    const keys = groups.flatMap((group) => group.items.flatMap((item) => item.keys));
    expect(keys).toContain("Space");
    expect(keys).toContain("Shift+Space");
    expect(keys).not.toContain("Espaço");
    expect(groups.flatMap((group) => group.items.map((item) => item.text))).toContain("Next row");
  });

  it("em portugues continuam as teclas e os textos de sempre", async () => {
    await i18n.changeLanguage("pt-BR");
    const keys = shortcutGroups().flatMap((group) => group.items.flatMap((item) => item.keys));
    expect(keys).toContain("Espaço");
    expect(keys).toContain("Shift+Espaço");
  });
});

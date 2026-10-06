import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { actionLabel, actionSummary, fieldLabel, matchModeLabel, opLabel, triggerSummary, typeLabel, type NameLookups } from "./presentation";

const lookups: NameLookups = {
  accounts: new Map([["acc-1", "Checking"]]),
  categories: new Map([["cat-1", "Groceries"]]),
  tags: new Map(),
  budgets: new Map(),
  bills: new Map(),
};

// A logica de regras no idioma ingles: rotulos de campo, operacao, tipo, acao e os resumos montados.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("rotulos", () => {
  it("campo, operacao, tipo, acao e combinacao em ingles", () => {
    expect(fieldLabel("description")).toBe("Description");
    expect(opLabel("contains")).toBe("contains");
    expect(typeLabel("withdrawal")).toBe("Expense");
    expect(actionLabel("set_category")).toBe("Set category");
    expect(matchModeLabel("all")).toBe("All triggers must match");
  });
});

describe("resumos", () => {
  it("resumo do gatilho e da acao", () => {
    expect(triggerSummary({ field: "description", op: "contains", value: "market" }, lookups)).toBe('Description contains "market"');
    expect(triggerSummary({ field: "account", op: "is", value: "sumiu" }, lookups)).toBe("Account is removed item");
    expect(actionSummary({ kind: "set_category", target_id: "cat-1" }, lookups)).toBe("Category: Groceries");
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(fieldLabel("description")).toBe("Descrição");
    expect(actionLabel("set_category")).toBe("Definir categoria");
  });
});

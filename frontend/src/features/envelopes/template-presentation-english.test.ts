import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Template } from "@/api/envelopes";
import { i18n } from "@/i18n";
import { applyCountText, goalLabel, kindLabel, kindOptions, reasonLabel, templateSummary } from "./template-presentation";

const template = (overrides: Partial<Template>): Template => ({
  kind: "fixed",
  amount: null,
  target_month: null,
  bill_id: null,
  ...overrides,
});

// Os templates de envelope no idioma ingles: rotulos de tipo, resumo, selo de meta, motivo e contagem.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("tipos e resumo", () => {
  it("rotulo do tipo em ingles", () => {
    expect(kindLabel("by_date")).toBe("Save up by a date");
    expect(kindOptions().every((option) => option.label && option.description)).toBe(true);
  });

  it("resumo do template", () => {
    expect(templateSummary(template({ kind: "fixed", amount: "300.00" }), "USD")).toBe("$300.00 per month");
    expect(templateSummary(template({ kind: "bill", bill_id: "x" }), "USD", "Rent")).toBe("Bill: Rent");
    expect(templateSummary(template({ kind: "remainder" }), "USD")).toBe("Whatever's left");
  });
});

describe("selo, motivo e contagem", () => {
  it("selo de meta", () => {
    expect(goalLabel("met")).toBe("Goal met");
    expect(goalLabel("short")).toBe("Far from goal");
  });

  it("motivo de nao aplicar", () => {
    expect(reasonLabel("already_has")).toBe("Already has an amount");
    expect(reasonLabel("no_money_left")).toBe("No money left");
  });

  it("contagem no singular, no plural e no zero", () => {
    expect(applyCountText(0)).toBe("No envelopes will change.");
    expect(applyCountText(1)).toBe("1 envelope will change.");
    expect(applyCountText(3)).toBe("3 envelopes will change.");
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(kindLabel("by_date")).toBe("Juntar até uma data");
    expect(applyCountText(0)).toBe("Nenhum envelope vai mudar.");
  });
});

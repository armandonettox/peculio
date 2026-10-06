import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { periodLabel, remainingText, stateLabel } from "./presentation";

// A logica de orcamentos no idioma ingles: rotulos de periodo, selo de situacao e o texto do que resta.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("rotulos", () => {
  it("periodo e selo em ingles", () => {
    expect(periodLabel("monthly")).toBe("Monthly");
    expect(periodLabel("yearly")).toBe("Yearly");
    expect(stateLabel("ok")).toBeNull();
    expect(stateLabel("warning")).toBe("Near the limit");
    expect(stateLabel("over")).toBe("Limit reached");
  });

  it("texto do que resta ou do que passou", () => {
    expect(remainingText({ remaining: "50.00", currency_code: "USD" })).toBe("$50.00 left");
    expect(remainingText({ remaining: "-30.00", currency_code: "USD" })).toBe("Went $30.00 over the limit");
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(periodLabel("monthly")).toBe("Mensal");
    expect(stateLabel("warning")).toBe("Perto do limite");
    expect(remainingText({ remaining: "50.00", currency_code: "BRL" })).toBe("Restam R$ 50,00");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { availableText, remainingText, targetText } from "./presentation";

// A logica de cofrinhos no idioma ingles: o que falta, a data alvo e o disponivel na conta.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("textos", () => {
  it("o que falta ou a meta atingida", () => {
    expect(remainingText({ percent: 50, remaining: "40.00", currency_code: "USD" })).toBe("$40.00 left");
    expect(remainingText({ percent: 100, remaining: "0.00", currency_code: "USD" })).toBe("Goal reached");
  });

  it("data alvo: dentro do prazo, passada ou com sugestao por mes", () => {
    expect(targetText({ target_date: null, suggested_per_month: null, currency_code: "USD", percent: 0 }, "2026-03-10")).toBeNull();
    expect(
      targetText({ target_date: "2025-12-31", suggested_per_month: null, currency_code: "USD", percent: 50 }, "2026-03-10"),
    ).toBe("Target date has passed (12/31/2025)");
    expect(
      targetText({ target_date: "2026-12-31", suggested_per_month: "100.00", currency_code: "USD", percent: 50 }, "2026-03-10"),
    ).toBe("By 12/31/2026 · save $100.00 a month");
  });

  it("disponivel na conta, normal ou abaixo do guardado", () => {
    expect(availableText({ account_name: "Checking", account_available: "200.00", currency_code: "USD" })).toEqual({
      text: "Available in Checking: $200.00",
      warning: false,
    });
    expect(availableText({ account_name: "Checking", account_available: "-50.00", currency_code: "USD" })).toEqual({
      text: "The balance of Checking is $50.00 below what's saved in piggy banks",
      warning: true,
    });
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(remainingText({ percent: 100, remaining: "0.00", currency_code: "BRL" })).toBe("Meta atingida");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { amountRangeText, frequencyLabel, matchText, nextDueText, statusText } from "./presentation";

// A logica de contas a pagar no idioma ingles: frequencia, faixa de valor, situacao e vencimento.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("rotulos e textos", () => {
  it("frequencia em ingles", () => {
    expect(frequencyLabel("monthly")).toBe("Monthly");
    expect(frequencyLabel("half_yearly")).toBe("Semiannual");
  });

  it("faixa de valor igual ou diferente", () => {
    expect(amountRangeText({ amount_min: "10.00", amount_max: "10.00", currency_code: "USD" })).toBe("$10.00");
    expect(amountRangeText({ amount_min: "10.00", amount_max: "20.00", currency_code: "USD" })).toBe("$10.00 to $20.00");
  });

  it("situacao: paga, atrasada (uma ou varias) e a vencer", () => {
    expect(statusText({ status: "paid", last_due_date: null, overdue_count: 0, oldest_overdue_date: null })).toBe("Paid");
    expect(statusText({ status: "upcoming", last_due_date: null, overdue_count: 0, oldest_overdue_date: null })).toBe("Upcoming");
    expect(
      statusText({ status: "overdue", last_due_date: "2026-03-01", overdue_count: 1, oldest_overdue_date: "2026-03-01" }),
    ).toBe("Overdue · was due on 03/01/2026");
    expect(
      statusText({ status: "overdue", last_due_date: "2026-03-01", overdue_count: 3, oldest_overdue_date: "2026-01-01" }),
    ).toBe("Overdue · 3 overdue payments, the oldest on 01/01/2026");
  });

  it("vencimento relativo e texto de ligacao automatica", () => {
    expect(nextDueText({ next_due_date: "2026-03-10" }, "2026-03-10")).toBe("Next due date: 03/10/2026 (today)");
    expect(matchText({ match_text: "rent" })).toBe('Auto-links when it contains “rent”');
    expect(matchText({ match_text: null })).toBe("No automatic link");
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(frequencyLabel("monthly")).toBe("Mensal");
    expect(statusText({ status: "paid", last_due_date: null, overdue_count: 0, oldest_overdue_date: null })).toBe("Pago");
  });
});

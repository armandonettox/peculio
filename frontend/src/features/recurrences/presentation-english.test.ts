import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { amountRangeText, createdText, endText, frequencyLabel, matchText, nextDueText, nextText, statusText } from "./presentation";

// A logica de recorrentes no idioma ingles: frequencia, plural de criadas e situacao do proximo lancamento.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("rotulos e textos", () => {
  it("frequencia em ingles", () => {
    expect(frequencyLabel("daily")).toBe("Daily");
    expect(frequencyLabel("quarterly")).toBe("Quarterly");
  });

  it("criadas no singular e no plural", () => {
    expect(createdText(1)).toBe("1 created");
    expect(createdText(3)).toBe("3 created");
  });

  it("quando termina: sem data, com data ou por vezes", () => {
    expect(endText({ end_date: null, max_occurrences: null, created_count: 0 })).toBe("No end date");
    expect(endText({ end_date: "2026-12-31", max_occurrences: null, created_count: 0 })).toBe("Until 12/31/2026");
    expect(endText({ end_date: null, max_occurrences: 1, created_count: 1 })).toBe("1 time (1 created)");
    expect(endText({ end_date: null, max_occurrences: 12, created_count: 3 })).toBe("12 times (3 created)");
  });

  it("situacao do proximo lancamento", () => {
    expect(nextText({ active: true, next_date: null }, "2026-03-10")).toBe("Ended");
    expect(nextText({ active: false, next_date: "2026-04-01" }, "2026-03-10")).toBe("Paused");
    expect(nextText({ active: true, next_date: "2026-03-10" }, "2026-03-10")).toBe("Next: 03/10/2026 (today)");
  });

  it("faixa de valor igual ou diferente (modo de lembrete)", () => {
    expect(amountRangeText({ amount_min: "10.00", amount_max: "10.00", currency_code: "USD" })).toBe("$10.00");
    expect(amountRangeText({ amount_min: "10.00", amount_max: "20.00", currency_code: "USD" })).toBe("$10.00 to $20.00");
  });

  it("situacao: paga, atrasada (uma ou varias) e a vencer (modo de lembrete)", () => {
    expect(statusText({ status: "paid", last_due_date: null, overdue_count: 0, oldest_overdue_date: null })).toBe("Paid");
    expect(statusText({ status: "upcoming", last_due_date: null, overdue_count: 0, oldest_overdue_date: null })).toBe("Upcoming");
    expect(
      statusText({ status: "overdue", last_due_date: "2026-03-01", overdue_count: 1, oldest_overdue_date: "2026-03-01" }),
    ).toBe("Overdue · was due on 03/01/2026");
    expect(
      statusText({ status: "overdue", last_due_date: "2026-03-01", overdue_count: 3, oldest_overdue_date: "2026-01-01" }),
    ).toBe("Overdue · 3 overdue payments, the oldest on 01/01/2026");
  });

  it("vencimento relativo e texto de ligacao automatica (modo de lembrete)", () => {
    expect(nextDueText({ next_due_date: "2026-03-10" }, "2026-03-10")).toBe("Next due date: 03/10/2026 (today)");
    expect(matchText({ match_text: "rent" })).toBe('Auto-links when it contains “rent”');
    expect(matchText({ match_text: null })).toBe("No automatic link");
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(frequencyLabel("daily")).toBe("Diária");
    expect(createdText(1)).toBe("1 criada");
  });
});

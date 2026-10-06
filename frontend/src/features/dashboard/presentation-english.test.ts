import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BudgetProgress } from "@/api/budgets";
import type { UpcomingItem } from "@/api/dashboard";
import { i18n } from "@/i18n";
import { buildAlerts, directionText, formatDiff, formatPercent, shortDayLabel, upcomingAmountText } from "./presentation";

// A logica do painel no idioma ingles: textos, plurais e o formato de numeros e datas americano.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

const overdue = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), overdue: true }) as UpcomingItem);
const budget = (percent: number) => ({ percent }) as BudgetProgress;

describe("comparacao com o mes passado", () => {
  it("diferenca em ingles", () => {
    expect(formatDiff("0.00", "USD")).toBe("Same as last month");
    expect(formatDiff("120.00", "USD")).toBe("$120.00 more");
    expect(formatDiff("-50.00", "USD")).toBe("$50.00 less");
  });

  it("porcentagem com ponto decimal e sem base", () => {
    expect(formatPercent(12.34)).toBe("+12.3%");
    expect(formatPercent(-5)).toBe("-5.0%");
    expect(formatPercent(null)).toBe("No basis for comparison");
  });
});

describe("textos de vencimentos", () => {
  it("faixa de valores e sentido", () => {
    const base = { amount_min: "40.00", amount_max: "60.00", currency_code: "USD" };
    expect(upcomingAmountText(base)).toBe("$40.00 to $60.00");
    expect(directionText("in")).toBe("Incoming");
    expect(directionText("out")).toBe("Outgoing");
    expect(directionText("transfer" as UpcomingItem["direction"])).toBe("Transfer");
  });
});

describe("alertas com plural", () => {
  it("uma conta atrasada no singular e varias no plural", () => {
    expect(buildAlerts(overdue(1), [])[0].text).toBe("1 overdue bill");
    expect(buildAlerts(overdue(3), [])[0].text).toBe("3 overdue bills");
  });

  it("orcamentos no limite e perto do limite, com a porcentagem", () => {
    expect(buildAlerts([], [budget(120)])[0].text).toBe("1 budget at its limit");
    expect(buildAlerts([], [budget(120), budget(100)])[0].text).toBe("2 budgets at their limit");
    expect(buildAlerts([], [budget(85)])[0].text).toMatch(/^1 budget near its limit \(above \d+%\)$/);
    expect(buildAlerts([], [budget(85), budget(90)])[0].text).toMatch(/^2 budgets near their limit/);
  });
});

describe("datas curtas", () => {
  it("hoje e ontem", () => {
    expect(shortDayLabel("2026-03-10", "2026-03-10")).toBe("Today");
    expect(shortDayLabel("2026-03-09", "2026-03-10")).toBe("Yesterday");
  });

  it("mes antes do dia no ingles americano, e o ano so quando e outro ano", () => {
    expect(shortDayLabel("2026-03-04", "2026-03-10")).toBe("03/04");
    expect(shortDayLabel("2025-12-31", "2026-03-10")).toBe("12/31/25");
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos, plurais e formatos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(formatDiff("-50.00", "BRL")).toContain("a menos");
    expect(formatPercent(12.34)).toBe("+12,3%");
    expect(buildAlerts(overdue(2), [])[0].text).toBe("2 contas atrasadas");
    expect(shortDayLabel("2026-03-04", "2026-03-10")).toBe("04/03");
    expect(shortDayLabel("2025-12-31", "2026-03-10")).toBe("31/12/25");
  });
});

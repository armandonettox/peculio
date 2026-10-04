import { describe, expect, it } from "vitest";

import type { Template } from "@/api/envelopes";
import {
  KIND_OPTIONS,
  applyCountText,
  goalLabel,
  kindLabel,
  reasonLabel,
  templateSummary,
} from "./template-presentation";

const money = (text: string) => text.replace(/\s/g, " ");
const template = (overrides: Partial<Template>): Template => ({
  kind: "fixed",
  amount: null,
  target_month: null,
  bill_id: null,
  ...overrides,
});

describe("tipos", () => {
  it("sao quatro, com rotulo e explicacao", () => {
    expect(KIND_OPTIONS.map((option) => option.value)).toEqual(["fixed", "by_date", "bill", "remainder"]);
    expect(KIND_OPTIONS.every((option) => option.label && option.description)).toBe(true);
    expect(kindLabel("by_date")).toBe("Juntar até uma data");
  });
});

describe("templateSummary", () => {
  it("valor fixo", () => {
    expect(money(templateSummary(template({ kind: "fixed", amount: "300.00" }), "BRL"))).toBe("R$ 300,00 por mês");
  });

  it("meta por data usa o mes em minusculo", () => {
    const summary = templateSummary(template({ kind: "by_date", amount: "6000.00", target_month: "2026-06-01" }), "BRL");
    expect(money(summary)).toBe("R$ 6.000,00 até junho de 2026");
  });

  it("conta a pagar com e sem o nome", () => {
    expect(templateSummary(template({ kind: "bill", bill_id: "x" }), "BRL", "Aluguel")).toBe("Conta: Aluguel");
    expect(templateSummary(template({ kind: "bill", bill_id: "x" }), "BRL")).toBe("Conta a pagar");
  });

  it("o que sobrar", () => {
    expect(templateSummary(template({ kind: "remainder" }), "BRL")).toBe("O que sobrar");
  });

  it("usa a moeda do envelope", () => {
    expect(templateSummary(template({ kind: "fixed", amount: "10.00" }), "USD")).toContain("US$");
  });
});

describe("selo, motivos e contagem", () => {
  it("cada selo tem texto proprio", () => {
    expect(goalLabel("met")).toBe("Meta batida");
    expect(goalLabel("partial")).toBe("Falta pouco");
    expect(goalLabel("short")).toBe("Longe da meta");
  });

  it("cada motivo tem texto proprio", () => {
    const texts = (["already_has", "goal_met", "date_passed", "no_due_date", "no_money_left"] as const).map(reasonLabel);
    expect(new Set(texts).size).toBe(5);
    expect(reasonLabel("already_has")).toBe("Já tem valor");
  });

  it("a contagem fala no singular e no plural", () => {
    expect(applyCountText(0)).toBe("Nenhum envelope vai mudar.");
    expect(applyCountText(1)).toBe("1 envelope vai mudar.");
    expect(applyCountText(3)).toBe("3 envelopes vão mudar.");
  });
});

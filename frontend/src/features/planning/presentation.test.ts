import { describe, expect, it } from "vitest";

import { barSegments, formatPercent, isOver, lastOfMonth, monthKey, monthStart, percentOfLimit, shiftMonthKey } from "./presentation";

describe("meses", () => {
  it("monthKey e monthStart se completam", () => {
    expect(monthKey("2026-11-15")).toBe("2026-11");
    expect(monthStart("2026-11")).toBe("2026-11-01");
  });

  it("lastOfMonth acha o ultimo dia, inclusive em fevereiro e em ano bissexto", () => {
    expect(lastOfMonth("2026-11-07")).toBe("2026-11-30");
    expect(lastOfMonth("2026-12-01")).toBe("2026-12-31");
    expect(lastOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(lastOfMonth("2028-02-10")).toBe("2028-02-29");
  });

  it("shiftMonthKey anda para tras e para frente, virando o ano", () => {
    expect(shiftMonthKey("2026-11", 1)).toBe("2026-12");
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-11", 0)).toBe("2026-11");
  });
});

describe("barSegments", () => {
  const sum = (s: ReturnType<typeof barSegments>) => s.paidWithin + s.expectedWithin + s.paidOver + s.expectedOver;

  it("sem limite e sem gasto a barra fica vazia", () => {
    expect(barSegments({ planned: "0.00", paid: "0.00", expected: "0.00" })).toEqual({
      paidWithin: 0,
      expectedWithin: 0,
      paidOver: 0,
      expectedOver: 0,
    });
  });

  it("dentro do limite: pago e previsto dividem a parte usada, e o resto da barra fica livre", () => {
    const s = barSegments({ planned: "1000.00", paid: "250.00", expected: "250.00" });
    expect(s.paidWithin).toBeCloseTo(25);
    expect(s.expectedWithin).toBeCloseTo(25);
    expect(s.paidOver).toBe(0);
    expect(s.expectedOver).toBe(0);
    expect(sum(s)).toBeCloseTo(50);
  });

  it("estourou so no previsto: o pago enche a parte dele e o previsto passa do limite", () => {
    const s = barSegments({ planned: "100.00", paid: "60.00", expected: "90.00" });
    // total 150, a barra cobre 150: pago 60, previsto dentro 40, previsto fora 50
    expect(s.paidWithin).toBeCloseTo(40);
    expect(s.expectedWithin).toBeCloseTo((40 / 150) * 100);
    expect(s.expectedOver).toBeCloseTo((50 / 150) * 100);
    expect(s.paidOver).toBe(0);
    expect(sum(s)).toBeCloseTo(100);
  });

  it("o pago ja passou do limite: o excedente e pago e todo o previsto e excedente", () => {
    const s = barSegments({ planned: "100.00", paid: "130.00", expected: "20.00" });
    expect(s.paidWithin).toBeCloseTo((100 / 150) * 100);
    expect(s.paidOver).toBeCloseTo((30 / 150) * 100);
    expect(s.expectedWithin).toBe(0);
    expect(s.expectedOver).toBeCloseTo((20 / 150) * 100);
    expect(sum(s)).toBeCloseTo(100);
  });

  it("gasto sem limite (limite zero) e todo excedente", () => {
    const s = barSegments({ planned: "0.00", paid: "10.00", expected: "0.00" });
    expect(s.paidOver).toBeCloseTo(100);
    expect(s.paidWithin).toBe(0);
  });

  it("gastou exatamente o limite: barra cheia, sem excedente", () => {
    const s = barSegments({ planned: "100.00", paid: "100.00", expected: "0.00" });
    expect(s.paidWithin).toBeCloseTo(100);
    expect(s.paidOver + s.expectedOver).toBe(0);
  });
});

describe("percentuais", () => {
  it("percentOfLimit divide pelo limite e devolve null sem limite", () => {
    expect(percentOfLimit("10.04", "1500.00")).toBeCloseTo(0.6693, 3);
    expect(percentOfLimit("50.00", "0.00")).toBeNull();
    expect(percentOfLimit("150.00", "100.00")).toBeCloseTo(150);
  });

  it("formatPercent usa ate duas casas e sem zeros sobrando", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(12)).toBe("12%");
    expect(formatPercent(0.6693)).toBe("0,67%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(null)).toBe("-");
  });

  it("isOver olha o sinal do restante", () => {
    expect(isOver("-0.01")).toBe(true);
    expect(isOver("0.00")).toBe(false);
    expect(isOver("10.00")).toBe(false);
  });
});

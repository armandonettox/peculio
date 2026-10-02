import { expect, it } from "vitest";

import { barPercent, longMonthLabel, netClass, rowName, shortMonthLabel } from "./presentation";

it("barPercent e proporcional ao maior valor e nunca passa de 100", () => {
  expect(barPercent("500.50", "500.50")).toBe(100);
  expect(barPercent("250.25", "500.50")).toBe(50);
  expect(barPercent("45.90", "500.50")).toBe(9);
});

it("barPercent: valor pequeno ainda aparece e zero some", () => {
  expect(barPercent("0.01", "1000.00")).toBe(1);
  expect(barPercent("0.00", "1000.00")).toBe(0);
  expect(barPercent("0", "0")).toBe(0);
  expect(barPercent("10.00", "0.00")).toBe(0);
});

it("netClass: positivo e zero verde, negativo vermelho", () => {
  expect(netClass("10.00")).toBe("text-positive");
  expect(netClass("0.00")).toBe("text-positive");
  expect(netClass("-0.00")).toBe("text-positive");
  expect(netClass("-0.01")).toBe("text-destructive");
});

it("rowName usa o texto proprio quando nao ha id", () => {
  const row = { id: null, name: "Sem categoria", income: "0", expense: "0", net: "0", count: 1 };
  expect(rowName(row, "Sem categoria")).toBe("Sem categoria");
  expect(rowName({ ...row, id: "x", name: "Mercado" }, "Sem categoria")).toBe("Mercado");
});

it("nomes dos meses", () => {
  expect(shortMonthLabel("2026-03")).toBe("mar/26");
  expect(shortMonthLabel("2026-09")).toBe("set/26");
  expect(longMonthLabel("2026-03")).toBe("março de 2026");
});

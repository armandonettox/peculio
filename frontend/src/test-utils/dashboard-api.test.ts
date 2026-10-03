import { expect, it } from "vitest";

import { makeNetWorth, makeNetWorthCurrency, monthsEndingAt } from "./dashboard-api";

it("os meses terminam no ultimo informado e atravessam a virada do ano", () => {
  expect(monthsEndingAt("2026-03", 4)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
  expect(monthsEndingAt("2026-01", 1)).toEqual(["2026-01"]);
  expect(monthsEndingAt("2026-12", 2)).toEqual(["2026-11", "2026-12"]);
});

it("a serie do patrimonio fecha: ativos mais dividas sao o liquido e o total de hoje e o ultimo ponto", () => {
  const brl = makeNetWorthCurrency("BRL", ["100.00", "250.50"], { debt: "40.00" });
  expect(brl.series).toEqual([
    { month: "2026-02", assets: "140.00", liabilities: "-40.00", net: "100.00" },
    { month: "2026-03", assets: "290.50", liabilities: "-40.00", net: "250.50" },
  ]);
  expect({ assets: brl.assets, liabilities: brl.liabilities, net: brl.net }).toEqual({
    assets: "290.50",
    liabilities: "-40.00",
    net: "250.50",
  });
});

it("o patrimonio de exemplo tem uma moeda e 'months' igual ao tamanho da serie", () => {
  const data = makeNetWorth();
  expect(data.currencies).toHaveLength(1);
  expect(data.months).toBe(data.currencies[0].series.length);
});

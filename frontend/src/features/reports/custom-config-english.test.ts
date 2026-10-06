import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import {
  chartOptions,
  groupByLabel,
  groupByOptions,
  measureOptions,
  periodOptions,
  reportTitle,
} from "./custom-config";

// O montador do relatorio personalizado no idioma ingles: opcoes e o titulo montado.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

it("opcoes de agrupar, medir, grafico e periodo em ingles", () => {
  expect(groupByOptions().map((o) => o.label)).toContain("Category");
  expect(measureOptions().map((o) => o.label)).toContain("Income");
  expect(chartOptions().map((o) => o.label)).toContain("Donut");
  expect(periodOptions().map((o) => o.label)).toContain("This month");
});

it("titulo do relatorio por mes e por grupo", () => {
  expect(reportTitle("month", "expense")).toBe("Expenses month by month");
  expect(reportTitle("category", "income")).toBe("Income by category");
  expect(groupByLabel("budget")).toBe("Budget");
});

it("volta aos textos brasileiros", async () => {
  await i18n.changeLanguage("pt-BR");
  expect(reportTitle("month", "expense")).toBe("Despesas mês a mês");
});

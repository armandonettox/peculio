import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";

import type { RankedItem } from "./custom-data";
import { RankedBars } from "./ranked-bars";

const item = (label: string, value: string, isOther = false): RankedItem => ({ key: label, label, value, isOther });
const bar = (label: string) => within(screen.getByText(label).closest("li") as HTMLElement).getByText("", { selector: "span[aria-hidden] > span" });

it("uma linha por grupo com o nome e o valor em texto", () => {
  render(<RankedBars title="Despesas por categoria em BRL" items={[item("Mercado", "500.50"), item("Lazer", "30.00")]} currencyCode="BRL" measure="expense" />);
  const list = screen.getByRole("list", { name: "Despesas por categoria em BRL" });
  const entries = within(list).getAllByRole("listitem");
  expect(entries).toHaveLength(2);
  expect(entries[0].textContent?.replace(/\s/g, " ")).toContain("Mercado");
  expect(entries[0].textContent?.replace(/\s/g, " ")).toContain("R$ 500,50");
  expect(entries[1].textContent?.replace(/\s/g, " ")).toContain("R$ 30,00");
});

it("a barra e so visual: fica fora da leitura de tela", () => {
  render(<RankedBars title="x" items={[item("A", "10.00")]} currencyCode="BRL" measure="expense" />);
  expect(document.querySelector('span[aria-hidden="true"]')).not.toBeNull();
});

it("o tamanho da barra segue o maior valor", () => {
  render(<RankedBars title="x" items={[item("Grande", "200.00"), item("Metade", "100.00")]} currencyCode="BRL" measure="expense" />);
  expect(bar("Grande")).toHaveStyle({ width: "100%" });
  expect(bar("Metade")).toHaveStyle({ width: "50%" });
});

it.each([
  ["expense", "bg-destructive"],
  ["income", "bg-positive"],
] as const)("a cor de %s", (measure, expected) => {
  render(<RankedBars title="x" items={[item("A", "10.00")]} currencyCode="BRL" measure={measure} />);
  expect(bar("A")).toHaveClass(expected);
});

it("no saldo a cor segue o sinal", () => {
  render(<RankedBars title="x" items={[item("Ganho", "50.00"), item("Perda", "-70.00")]} currencyCode="BRL" measure="net" />);
  expect(bar("Ganho")).toHaveClass("bg-positive");
  expect(bar("Perda")).toHaveClass("bg-destructive");
  // O valor negativo aparece com o sinal e a barra tem tamanho
  expect(screen.getByText("Perda").closest("li")?.textContent?.replace(/\s/g, " ")).toContain("-R$ 70,00");
  expect(bar("Perda")).toHaveStyle({ width: "100%" });
});

it("Outros fica neutro, qualquer que seja a medida", () => {
  render(<RankedBars title="x" items={[item("A", "100.00"), item("Outros", "40.00", true)]} currencyCode="BRL" measure="expense" />);
  expect(bar("Outros")).toHaveClass("bg-muted-foreground");
  expect(bar("A")).toHaveClass("bg-destructive");
});

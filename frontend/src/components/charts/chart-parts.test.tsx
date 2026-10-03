import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartTable, ChartTooltip, EmptyChart } from "./chart-parts";

describe("ChartTooltip", () => {
  // [horizontal, vertical, transform esperado]
  it.each([
    ["center", "above", "translate(-50%, calc(-100% - 12px))"],
    ["start", "above", "translate(-8px, calc(-100% - 12px))"],
    ["end", "above", "translate(calc(-100% + 8px), calc(-100% - 12px))"],
    ["center", "below", "translate(-50%, 12px)"],
    ["start", "below", "translate(-8px, 12px)"],
    ["end", "below", "translate(calc(-100% + 8px), 12px)"],
  ] as const)("%s e %s", (horizontal, vertical, transform) => {
    render(
      <ChartTooltip leftPercent={30} topPercent={40} placement={{ horizontal, vertical }}>
        texto
      </ChartTooltip>,
    );
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("texto");
    expect(tooltip.style.left).toBe("30%");
    expect(tooltip.style.top).toBe("40%");
    expect(tooltip.style.transform).toBe(transform);
  });

  it("nao captura o mouse (nao atrapalha o ponto embaixo)", () => {
    render(
      <ChartTooltip leftPercent={0} topPercent={0} placement={{ horizontal: "center", vertical: "above" }}>
        x
      </ChartTooltip>,
    );
    expect(screen.getByRole("tooltip")).toHaveClass("pointer-events-none");
  });
});

describe("ChartTable", () => {
  it("monta legenda, cabecalhos, titulos de linha e celulas", () => {
    render(
      <ChartTable
        caption="Gastos"
        headers={["Categoria", "Valor"]}
        rows={[
          { header: "Mercado", cells: ["R$ 10,00"] },
          { header: "Mercado", cells: ["R$ 20,00"] },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Gastos" });
    expect(table).toHaveClass("sr-only");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
    expect(within(table).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["R$ 10,00", "R$ 20,00"]);
  });
});

describe("EmptyChart", () => {
  it("mostra a mensagem e tem nome acessivel com o titulo", () => {
    render(<EmptyChart label="Patrimônio" kind="line" className="extra" />);
    const box = screen.getByRole("img", { name: "Patrimônio: sem dados no período" });
    expect(box).toHaveTextContent("Sem dados no período");
    expect(box).toHaveAttribute("data-chart", "line");
    expect(box).toHaveClass("extra");
  });
});

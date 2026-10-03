import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { expectNoBrokenNumbers, formatMoneyTest } from "./chart-test-helpers";
import { Sparkline } from "./sparkline";
import type { SparklineProps } from "./types";

function renderSpark(values: string[], extra: Partial<SparklineProps> = {}) {
  return render(<Sparkline label="Patrimônio nos últimos 12 meses" values={values} {...extra} />);
}

function lineOf(container: HTMLElement) {
  return container.querySelector("[data-line]");
}

describe("Sparkline", () => {
  it("tem role img com o rotulo recebido", () => {
    renderSpark(["1", "2", "3"]);
    expect(screen.getByRole("img", { name: "Patrimônio nos últimos 12 meses" })).toBeInTheDocument();
  });

  it("desenha uma linha com um ponto final, sem eixos", () => {
    const { container } = renderSpark(["10", "20", "15"]);
    const d = lineOf(container)?.getAttribute("d") ?? "";
    expect(d.match(/[ML]/g)).toHaveLength(3);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(container.querySelector("text")).toBeNull();
    expect(container.querySelectorAll("line")).toHaveLength(0);
  });

  it("o menor valor fica embaixo e o maior em cima", () => {
    const { container } = renderSpark(["0", "100", "50"]);
    const d = lineOf(container)?.getAttribute("d") ?? "";
    const ys = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]));
    expect(ys[0]).toBeGreaterThan(ys[2]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
  });

  it.each([
    ["positive", "var(--chart-positive)"],
    ["negative", "var(--chart-negative)"],
    ["neutral", "var(--chart-muted)"],
  ] as const)("tom %s usa o token %s", (tone, token) => {
    const { container } = renderSpark(["1", "2"], { tone });
    expect(lineOf(container)).toHaveStyle({ stroke: token });
    expect(container.querySelector("circle")).toHaveStyle({ fill: token });
    expect(container.firstElementChild).toHaveAttribute("data-tone", tone);
  });

  it("sem tom informado e neutro", () => {
    const { container } = renderSpark(["1", "2"]);
    expect(lineOf(container)).toHaveStyle({ stroke: "var(--chart-muted)" });
  });

  it("nao usa cor solta", () => {
    const { container } = renderSpark(["1", "2", "3"], { tone: "positive" });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("vazio: traco apagado, aviso no rotulo e sem tabela", () => {
    const { container } = renderSpark([]);
    expect(screen.getByRole("img", { name: "Patrimônio nos últimos 12 meses: sem dados" })).toBeInTheDocument();
    expect(container.querySelector("[data-empty]")).toBeInTheDocument();
    expect(lineOf(container)).toBeNull();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expectNoBrokenNumbers(container);
  });

  it("um ponto so: vira um ponto no centro, sem linha", () => {
    const { container } = renderSpark(["42.00"]);
    expect(lineOf(container)).toBeNull();
    const dot = container.querySelector("circle");
    expect(dot?.getAttribute("cx")).toBe("60");
    expect(dot?.getAttribute("cy")).toBe("16");
    expectNoBrokenNumbers(container);
  });

  it("todos iguais: linha reta no meio", () => {
    const { container } = renderSpark(["5", "5", "5", "5"]);
    const d = lineOf(container)?.getAttribute("d") ?? "";
    const ys = new Set([...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => m[2]));
    expect(ys).toEqual(new Set(["16"]));
  });

  it("negativos e valores enormes nao geram NaN", () => {
    const { container } = renderSpark(["-100.50", "0", "99999999999999999999999.99", "abc"]);
    expectNoBrokenNumbers(container);
  });

  it("a linha respeita a margem de 3 e o ponto final fica no ultimo valor", () => {
    const { container } = renderSpark(["0", "100", "50"]);
    const d = lineOf(container)?.getAttribute("d") ?? "";
    const pts = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    expect(pts[0].x).toBe(3);
    expect(pts[2].x).toBe(117);
    expect(pts[0].y).toBe(29);
    expect(pts[1].y).toBe(3);
    const dot = container.querySelector("circle");
    expect(Number(dot?.getAttribute("cx"))).toBe(pts[2].x);
    expect(Number(dot?.getAttribute("cy"))).toBe(pts[2].y);
  });

  it("texto invalido conta como zero e mantem a quantidade de pontos", () => {
    const { container } = renderSpark(["10", "abc", "20"]);
    expect(lineOf(container)?.getAttribute("d")?.match(/[ML]/g)).toHaveLength(3);
  });

  it("o traco do vazio e tracejado", () => {
    const { container } = renderSpark([]);
    expect(container.querySelector("[data-empty]")).toHaveAttribute("stroke-dasharray", "3 3");
  });

  it("tem tabela equivalente com legenda, cabecalhos e todos os valores", () => {
    renderSpark(["10.50", "20.00", "-3.25"], { formatValue: formatMoneyTest });
    const table = screen.getByRole("table", { name: "Patrimônio nos últimos 12 meses" });
    expect(table).toHaveClass("sr-only");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Posição", "Valor"]);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("1");
    expect(within(rows[1]).getByRole("cell")).toHaveTextContent("R$ 10,50");
    expect(within(rows[3]).getByRole("cell")).toHaveTextContent("-R$ 3,25");
  });

  it("sem formatValue, a tabela mostra o texto decimal", () => {
    renderSpark(["10.50", "20.00"]);
    const cells = within(screen.getByRole("table")).getAllByRole("cell");
    expect(cells.map((cell) => cell.textContent)).toEqual(["10.50", "20.00"]);
  });

  it("nao tem tooltip nem pontos focaveis", async () => {
    const user = userEvent.setup();
    const { container } = renderSpark(["1", "2", "3"]);
    expect(container.querySelector("[tabindex]")).toBeNull();
    await user.hover(screen.getByRole("img"));
    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("aceita className e nao anima", () => {
    const { container } = renderSpark(["1", "2"], { className: "h-4 w-16" });
    expect(container.firstElementChild).toHaveClass("h-4", "w-16");
    expect(container.firstElementChild).not.toHaveClass("h-8");
    expect(container.innerHTML).not.toMatch(/<animate|transition|animation/i);
  });
});

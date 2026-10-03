import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { expectNoBrokenNumbers, formatMonthTest, formatMoneyTest, monthKeys } from "./chart-test-helpers";
import { LineChart } from "./line-chart";
import type { LineChartProps, LineSeries } from "./types";

function renderChart(series: LineSeries[], extra: Partial<LineChartProps> = {}) {
  return render(
    <LineChart title="Patrimônio" series={series} formatValue={formatMoneyTest} formatX={formatMonthTest} {...extra} />,
  );
}

const sample: LineSeries = {
  key: "total",
  label: "Total",
  points: [
    { x: "2026-01", value: "1000.00" },
    { x: "2026-02", value: "1500.50" },
    { x: "2026-03", value: "1200.00" },
  ],
};

function pointsOf(container: HTMLElement) {
  return container.querySelectorAll<SVGPathElement>("[data-point]");
}

afterEach(() => vi.restoreAllMocks());

describe("LineChart: acessibilidade e tabela equivalente", () => {
  it("tem role img com resumo que cita titulo, periodo e faixa de valores", () => {
    renderChart([sample]);
    const img = screen.getByRole("img", { name: /Patrimônio/ });
    const label = img.getAttribute("aria-label") ?? "";
    expect(label).toContain("1 série");
    expect(label).toContain("3 períodos");
    expect(label).toContain("de jan/26 a mar/26");
    expect(label).toContain("R$ 1.000,00 a R$ 1.500,50");
  });

  it("a tabela equivalente tem legenda, cabecalhos e todos os valores formatados", () => {
    renderChart([sample]);
    const table = screen.getByRole("table", { name: "Patrimônio" });
    expect(table).toHaveClass("sr-only");
    expect(within(table).getByRole("columnheader", { name: "Período" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Total" })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByRole("rowheader", { name: "jan/26" })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("cell")).toHaveTextContent("R$ 1.000,00");
    expect(within(rows[2]).getByRole("cell")).toHaveTextContent("R$ 1.500,50");
    expect(within(rows[3]).getByRole("cell")).toHaveTextContent("R$ 1.200,00");
  });

  it("varias series: uma coluna por serie", () => {
    renderChart([sample, { key: "debt", label: "Dívidas", points: [{ x: "2026-01", value: "-300.00" }] }]);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Período", "Total", "Dívidas"]);
    const firstRow = within(table).getAllByRole("row")[1];
    expect(within(firstRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["R$ 1.000,00", "-R$ 300,00"]);
  });

  it("serie sem ponto num periodo mostra 'Sem dado' na tabela", () => {
    renderChart([sample, { key: "b", label: "Outra", points: [{ x: "2026-02", value: "10" }] }]);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[1]).getAllByRole("cell")[1]).toHaveTextContent("Sem dado");
    expect(within(rows[2]).getAllByRole("cell")[1]).toHaveTextContent("R$ 10,00");
  });

  it("a descricao vira texto de apoio ligado ao desenho", () => {
    renderChart([sample], { description: "Soma de todas as contas" });
    const img = screen.getByRole("img", { name: /Patrimônio/ });
    expect(img).toHaveAccessibleDescription("Soma de todas as contas");
  });

  it("nao usa animacao nem transicao (reduced motion respeitado por nao animar)", () => {
    const { container } = renderChart([sample]);
    expect(container.innerHTML).not.toMatch(/<animate|<set |transition|animation/i);
  });
});

describe("LineChart: casos de borda", () => {
  it("sem series mostra mensagem de vazio", () => {
    renderChart([]);
    expect(screen.getByText("Sem dados no período")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Patrimônio: sem dados no período" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("serie sem pontos mostra mensagem de vazio", () => {
    renderChart([{ key: "a", label: "A", points: [] }]);
    expect(screen.getByText("Sem dados no período")).toBeInTheDocument();
  });

  it("um ponto so: aparece no centro, sem NaN", () => {
    const { container } = renderChart([{ key: "a", label: "A", points: [{ x: "2026-05", value: "250.00" }] }]);
    expect(pointsOf(container)).toHaveLength(1);
    expect(screen.getByLabelText("mai/26: R$ 250,00")).toBeInTheDocument();
    expectNoBrokenNumbers(container);
  });

  it("todos os valores iguais: linha reta e eixo com 3 a 5 marcas", () => {
    const { container } = renderChart([
      { key: "a", label: "A", points: monthKeys(5).map((x) => ({ x, value: "400.00" })) },
    ]);
    expectNoBrokenNumbers(container);
    const labels = container.querySelectorAll("text[text-anchor='end']");
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(labels.length).toBeLessThanOrEqual(5);
    const ys = [...pointsOf(container)].map((p) => p.getAttribute("d"));
    expect(new Set(ys.map((d) => d?.split(" ")[1])).size).toBe(1);
  });

  it("tudo zero: sem NaN, com o zero como primeira marca", () => {
    const { container } = renderChart([
      { key: "a", label: "A", points: monthKeys(4).map((x) => ({ x, value: "0.00" })) },
    ]);
    expectNoBrokenNumbers(container);
    const labels = [...container.querySelectorAll("text[text-anchor='end']")].map((el) => el.textContent);
    expect(labels).toContain("R$ 0,00");
    expect(container.querySelector("[data-zero-line]")).toBeNull();
  });

  it("negativos: desenha a linha do zero e rotulo do zero", () => {
    const { container } = renderChart([
      {
        key: "a",
        label: "A",
        points: [
          { x: "2026-01", value: "-200.00" },
          { x: "2026-02", value: "300.00" },
          { x: "2026-03", value: "-50.00" },
        ],
      },
    ]);
    expect(container.querySelectorAll("[data-zero-line]")).toHaveLength(1);
    const labels = [...container.querySelectorAll("text[text-anchor='end']")].map((el) => el.textContent);
    expect(labels).toContain("R$ 0,00");
    expect(screen.getByLabelText("jan/26: -R$ 200,00")).toBeInTheDocument();
    expectNoBrokenNumbers(container);
  });

  it("so negativos: o zero tambem aparece", () => {
    const { container } = renderChart([
      { key: "a", label: "A", points: [{ x: "2026-01", value: "-200.00" }, { x: "2026-02", value: "-100.00" }] },
    ]);
    expect(container.querySelectorAll("[data-zero-line]")).toHaveLength(1);
  });

  it("sem negativos nao desenha linha do zero destacada", () => {
    const { container } = renderChart([sample]);
    expect(container.querySelector("[data-zero-line]")).toBeNull();
  });

  it("eixo Y sempre com 3 a 5 marcas", () => {
    for (const values of [["1", "2"], ["0", "1000000"], ["-5", "5"], ["10.01", "10.02"]]) {
      const { container, unmount } = renderChart([
        { key: "a", label: "A", points: values.map((value, i) => ({ x: monthKeys(2)[i], value })) },
      ]);
      const count = container.querySelectorAll("text[text-anchor='end']").length;
      expect(count, values.join()).toBeGreaterThanOrEqual(3);
      expect(count, values.join()).toBeLessThanOrEqual(5);
      unmount();
    }
  });

  it("36 pontos: afina os rotulos do eixo X, mas a tabela e os pontos ficam completos", () => {
    const keys = monthKeys(36);
    const { container } = renderChart([
      { key: "a", label: "A", points: keys.map((x, i) => ({ x, value: String(1000 + i * 37) })) },
    ]);
    expect(pointsOf(container)).toHaveLength(36);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(37);
    const xLabels = [...container.querySelectorAll("text[text-anchor='middle']")].map((el) => el.textContent);
    expect(xLabels.length).toBeLessThan(36);
    expect(xLabels.length).toBeGreaterThanOrEqual(3);
    expect(xLabels[xLabels.length - 1]).toBe("dez/26");
    expectNoBrokenNumbers(container);
  });

  it("em 390 px os rotulos nao se sobrepoem e o viewBox acompanha a largura", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 390 } as DOMRect);
    const keys = monthKeys(36);
    const { container } = renderChart([{ key: "a", label: "A", points: keys.map((x, i) => ({ x, value: String(i * 10) })) }]);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 390 220");
    const xs = [...container.querySelectorAll("text[text-anchor='middle']")].map((el) => Number(el.getAttribute("x")));
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(36 + 8 - 1);
    expect(xs.length).toBeLessThanOrEqual(8);
  });

  it("valores muito grandes nao quebram o desenho", () => {
    const { container } = renderChart([
      {
        key: "a",
        label: "A",
        points: [
          { x: "2026-01", value: "123456789012345678901234.50" },
          { x: "2026-02", value: "999999999999999999999999.99" },
        ],
      },
    ]);
    expectNoBrokenNumbers(container);
    expect(pointsOf(container)).toHaveLength(2);
  });

  it("texto que nao e numero nao gera NaN", () => {
    const { container } = renderChart([{ key: "a", label: "A", points: [{ x: "2026-01", value: "abc" }, { x: "2026-02", value: "5" }] }]);
    expectNoBrokenNumbers(container);
  });

  it("serie com buraco interrompe a linha em vez de ligar os vizinhos", () => {
    const { container } = renderChart([
      sample,
      {
        key: "gap",
        label: "Com buraco",
        points: [
          { x: "2026-01", value: "10" },
          { x: "2026-02", value: "20" },
          { x: "2026-04", value: "30" },
          { x: "2026-05", value: "40" },
        ],
      },
    ]);
    const path = container.querySelector("[data-series='gap']")?.getAttribute("d") ?? "";
    // Sao 4 periodos na serie, mas a ordem de x une os periodos das duas series: jan, fev, mar, abr, mai
    expect(path.match(/M/g)).toHaveLength(2);
  });
});

describe("LineChart: pontos, teclado e tooltip", () => {
  it("cada ponto e focavel e tem aria-label 'rotulo: valor'", () => {
    const { container } = renderChart([sample]);
    const points = pointsOf(container);
    expect(points).toHaveLength(3);
    points.forEach((point) => expect(point).toHaveAttribute("tabindex", "0"));
    expect([...points].map((p) => p.getAttribute("aria-label"))).toEqual([
      "jan/26: R$ 1.000,00",
      "fev/26: R$ 1.500,50",
      "mar/26: R$ 1.200,00",
    ]);
  });

  it("tab leva o foco ao primeiro ponto e o tooltip mostra rotulo e valor", async () => {
    const user = userEvent.setup();
    renderChart([sample]);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.tab();
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("jan/26");
    expect(tooltip).toHaveTextContent("R$ 1.000,00");
    await user.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent("fev/26");
    expect(screen.getByRole("tooltip")).toHaveTextContent("R$ 1.500,50");
  });

  it("sair do foco esconde o tooltip e Escape tambem", async () => {
    const user = userEvent.setup();
    renderChart([sample]);
    await user.tab();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.tab({ shift: true });
    expect(screen.getByRole("tooltip")).toHaveTextContent("jan/26");
  });

  it("passar o mouse mostra o tooltip e tirar esconde", async () => {
    const user = userEvent.setup();
    renderChart([sample]);
    const point = screen.getByLabelText("mar/26: R$ 1.200,00");
    await user.hover(point);
    expect(screen.getByRole("tooltip")).toHaveTextContent("R$ 1.200,00");
    await user.unhover(point);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("com varias series o rotulo inclui o nome da serie", async () => {
    const user = userEvent.setup();
    renderChart([sample, { key: "b", label: "Reserva", points: [{ x: "2026-01", value: "50" }] }]);
    expect(screen.getByLabelText("Reserva, jan/26: R$ 50,00")).toBeInTheDocument();
    await user.hover(screen.getByLabelText("Reserva, jan/26: R$ 50,00"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Reserva, jan/26");
  });

  it("o tooltip fica dentro da area (porcentagens entre 0 e 100)", async () => {
    const user = userEvent.setup();
    renderChart([sample]);
    await user.tab();
    const style = screen.getByRole("tooltip").getAttribute("style") ?? "";
    const left = Number(/left:\s*([\d.]+)%/.exec(style)?.[1]);
    const top = Number(/top:\s*([\d.]+)%/.exec(style)?.[1]);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(100);
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(100);
  });
});

describe("LineChart: posicao dos elementos", () => {
  function gridBounds(container: HTMLElement) {
    const line = container.querySelector("svg line");
    return { left: Number(line?.getAttribute("x1")), right: Number(line?.getAttribute("x2")) };
  }

  // O marcador (circulo) comeca em cx - raio
  function markerCenter(point: Element) {
    const d = point.getAttribute("d") ?? "";
    const [x, y] = d.slice(1).split(" ");
    return { x: Number(x) + 3.5, y: Number(y) };
  }

  it("os pontos seguem a ordem do eixo X, dentro da area do desenho", () => {
    const { container } = renderChart([sample]);
    const { left, right } = gridBounds(container);
    const centers = [...pointsOf(container)].map(markerCenter);
    for (let i = 1; i < centers.length; i++) expect(centers[i].x).toBeGreaterThan(centers[i - 1].x);
    expect(centers[0].x).toBeGreaterThan(left);
    expect(centers[2].x).toBeLessThan(right);
  });

  it("valor maior fica mais alto (y menor)", () => {
    const { container } = renderChart([sample]);
    const [jan, fev, mar] = [...pointsOf(container)].map(markerCenter);
    expect(fev.y).toBeLessThan(mar.y);
    expect(mar.y).toBeLessThan(jan.y);
  });

  it("um ponto so fica exatamente no centro da area", () => {
    const { container } = renderChart([{ key: "a", label: "A", points: [{ x: "2026-05", value: "250.00" }] }]);
    const { left, right } = gridBounds(container);
    const center = markerCenter(pointsOf(container)[0]);
    expect(center.x).toBeCloseTo((left + right) / 2, 1);
  });

  it("a margem esquerda comporta o rotulo mais largo do eixo Y", () => {
    const { container } = renderChart([sample]);
    const labels = [...container.querySelectorAll("text[text-anchor='end']")];
    const { left } = gridBounds(container);
    for (const label of labels) {
      const x = Number(label.getAttribute("x"));
      expect(x).toBeLessThan(left);
      expect(x - (label.textContent?.length ?? 0) * 11 * 0.58).toBeGreaterThanOrEqual(0);
    }
  });

  it("rotulos do eixo Y ficam em ordem: o maior em cima", () => {
    const { container } = renderChart([sample]);
    const ys = [...container.querySelectorAll("text[text-anchor='end']")].map((el) => Number(el.getAttribute("y")));
    const texts = [...container.querySelectorAll("text[text-anchor='end']")].map((el) => el.textContent);
    expect(texts[0]).toBe("R$ 1.000,00");
    expect(ys[0]).toBeGreaterThan(ys[ys.length - 1]);
  });

  it("area com negativos fecha no zero, nao na borda de baixo", () => {
    const { container } = renderChart(
      [{ key: "a", label: "A", points: [{ x: "2026-01", value: "-100.00" }, { x: "2026-02", value: "100.00" }] }],
      { area: true },
    );
    const zeroY = container.querySelector("[data-zero-line]")?.getAttribute("y1");
    expect(container.querySelector("[data-area]")?.getAttribute("d")).toMatch(new RegExp(`^M[\\d.]+ ${zeroY} `));
  });

  it("area so com positivos longe do zero fecha na borda de baixo", () => {
    const { container } = renderChart([sample], { area: true });
    const bottomLine = [...container.querySelectorAll("svg line")].reduce((max, line) =>
      Number(line.getAttribute("y1")) > Number(max.getAttribute("y1")) ? line : max,
    );
    const bottom = bottomLine.getAttribute("y1");
    expect(container.querySelector("[data-area]")?.getAttribute("d")).toMatch(new RegExp(`^M[\\d.]+ ${bottom} `));
  });
});

describe("LineChart: medidas e camadas", () => {
  it("a area do desenho termina 24 px antes da borda direita", () => {
    const { container } = renderChart([sample]);
    expect(container.querySelector("svg line")?.getAttribute("x2")).toBe("616");
  });

  it("com dois pontos os dois rotulos do eixo X aparecem", () => {
    const { container } = renderChart([{ key: "a", label: "A", points: [{ x: "2026-01", value: "1" }, { x: "2026-02", value: "2" }] }]);
    const labels = [...container.querySelectorAll("text[text-anchor='middle']")].map((el) => el.textContent);
    expect(labels).toEqual(["jan/26", "fev/26"]);
  });

  it("a camada dos pontos e um grupo nomeado com o titulo", () => {
    renderChart([sample]);
    expect(screen.getByRole("group", { name: "Pontos de Patrimônio" })).toBeInTheDocument();
  });

  it("a area e suave: bem transparente", () => {
    const { container } = renderChart([sample], { area: true });
    expect(Number(container.querySelector("[data-area]")?.getAttribute("fill-opacity"))).toBeLessThanOrEqual(0.2);
  });

  it("periodos sem ponto numa serie nao puxam o eixo para o zero", () => {
    const { container } = renderChart([sample, { key: "b", label: "B", points: [{ x: "2026-02", value: "1200.00" }] }]);
    const labels = [...container.querySelectorAll("text[text-anchor='end']")].map((el) => el.textContent);
    expect(labels).not.toContain("R$ 0,00");
  });

  it("o tooltip acompanha a posicao do ponto em porcentagem da largura e da altura", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 400 } as DOMRect);
    const user = userEvent.setup();
    const { container } = renderChart([sample]);
    const fev = pointsOf(container)[1];
    const center = (point: Element) => {
      const [x, y] = (point.getAttribute("d") ?? "").slice(1).split(" ");
      return { x: Number(x) + 3.5, y: Number(y) };
    };
    await user.hover(fev);
    const tooltip = screen.getByRole("tooltip");
    expect(parseFloat(tooltip.style.left)).toBeCloseTo((center(fev).x / 400) * 100, 0);
    expect(parseFloat(tooltip.style.top)).toBeCloseTo((center(fev).y / 220) * 100, 0);
    // No meio do grafico, o balao fica centralizado no ponto
    expect(tooltip.style.transform).toContain("-50%");
  });
});

describe("LineChart: foco fora dos pontos", () => {
  it("depois do ultimo ponto o tooltip some", async () => {
    const user = userEvent.setup();
    renderChart([sample]);
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent("mar/26");
    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("LineChart: cores, legenda e series", () => {
  it("a legenda tem o nome de cada serie", () => {
    const { container } = renderChart([sample, { key: "b", label: "Reserva", points: [{ x: "2026-01", value: "50" }] }]);
    const legend = container.querySelector("ul");
    expect(legend).toHaveAttribute("aria-hidden", "true");
    expect(legend).toHaveTextContent("Total");
    expect(legend).toHaveTextContent("Reserva");
  });

  it("cada cor mapeia para o token do tema, sem hex solto", () => {
    const { container } = renderChart([
      { ...sample, key: "a", color: "negative" },
      { ...sample, key: "b", color: "positive" },
      { ...sample, key: "c" },
    ]);
    expect(container.querySelector("[data-series='a']")).toHaveStyle({ stroke: "var(--chart-negative)" });
    expect(container.querySelector("[data-series='b']")).toHaveStyle({ stroke: "var(--chart-positive)" });
    // Sem cor informada, a terceira serie usa a terceira cor da lista (warning)
    expect(container.querySelector("[data-series='c']")).toHaveStyle({ stroke: "var(--chart-warning)" });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("com uma serie so, linha continua e marcador redondo", () => {
    const { container } = renderChart([sample]);
    expect(container.querySelector("[data-series='total']")).not.toHaveAttribute("stroke-dasharray");
  });

  it("com varias series, traco e marcador mudam para nao depender so da cor", () => {
    const { container } = renderChart([
      { ...sample, key: "a" },
      { ...sample, key: "b", label: "B" },
      { ...sample, key: "c", label: "C" },
    ]);
    const dashes = ["a", "b", "c"].map((key) => container.querySelector(`[data-series='${key}']`)?.getAttribute("stroke-dasharray"));
    expect(dashes[0]).toBeNull();
    expect(dashes[1]).toBeTruthy();
    expect(dashes[2]).toBeTruthy();
    expect(dashes[1]).not.toBe(dashes[2]);
    const shapes = ["a", "b", "c"].map((key) => container.querySelector(`[data-point='${key}:2026-01']`)?.getAttribute("d"));
    expect(new Set(shapes).size).toBe(3);
  });

  it("area suave: so aparece quando pedida, na cor da primeira serie", () => {
    const { container, rerender } = renderChart([{ ...sample, color: "accent" }]);
    expect(container.querySelector("[data-area]")).toBeNull();
    rerender(
      <LineChart title="Patrimônio" series={[{ ...sample, color: "accent" }]} formatValue={formatMoneyTest} formatX={formatMonthTest} area />,
    );
    const area = container.querySelector("[data-area]");
    expect(area).toBeInTheDocument();
    expect(area).toHaveStyle({ fill: "var(--chart-accent)" });
    expect(area?.getAttribute("d")).toMatch(/Z$/);
  });

  it("a legenda e os pontos usam o className recebido", () => {
    const { container } = renderChart([sample], { className: "minha-classe" });
    expect(container.firstElementChild).toHaveClass("minha-classe");
  });

  it("altura informada vira a altura do desenho", () => {
    const { container } = renderChart([sample], { height: 300 });
    expect(container.querySelector("svg")).toHaveAttribute("height", "300");
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toMatch(/ 300$/);
  });
});

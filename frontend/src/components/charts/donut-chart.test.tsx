import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { expectNoBrokenNumbers, formatMoneyTest } from "./chart-test-helpers";
import { DonutChart } from "./donut-chart";
import type { DonutChartProps, DonutSlice } from "./types";

function renderDonut(slices: DonutSlice[], extra: Partial<DonutChartProps> = {}) {
  return render(<DonutChart title="Gastos por categoria" slices={slices} formatValue={formatMoneyTest} {...extra} />);
}

const base: DonutSlice[] = [
  { key: "mercado", label: "Mercado", value: "600.00" },
  { key: "moradia", label: "Moradia", value: "300.00" },
  { key: "lazer", label: "Lazer", value: "100.00" },
];

function legendOf(container: HTMLElement) {
  return container.querySelector("ul") as HTMLElement;
}

describe("DonutChart: conteudo", () => {
  it("resumo acessivel com titulo, quantidade, total e maior fatia", () => {
    renderDonut(base);
    const label = screen.getByRole("img", { name: /Gastos por categoria/ }).getAttribute("aria-label");
    expect(label).toContain("3 fatias");
    expect(label).toContain("total R$ 1.000,00");
    expect(label).toContain("Maior: Mercado, 60%");
  });

  it("o resumo cita o centro quando informado", () => {
    renderDonut(base, { centerLabel: "Total", centerValue: "R$ 1.000,00" });
    expect(screen.getByRole("img", { name: /Total: R\$ 1\.000,00/ })).toBeInTheDocument();
  });

  it("a tabela equivalente tem legenda, cabecalhos, valores e percentuais", () => {
    renderDonut(base);
    const table = screen.getByRole("table", { name: "Gastos por categoria" });
    expect(table).toHaveClass("sr-only");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Categoria", "Valor", "Participação"]);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByRole("rowheader")).toHaveTextContent("Mercado");
    expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["R$ 600,00", "60%"]);
    expect(within(rows[3]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["R$ 100,00", "10%"]);
  });

  it("a legenda mostra cor, nome, valor e percentual de cada fatia", () => {
    const { container } = renderDonut(base);
    const legend = legendOf(container);
    expect(legend).toHaveAttribute("aria-hidden", "true");
    const items = within(legend).getAllByRole("listitem", { hidden: true });
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Mercado");
    expect(items[0]).toHaveTextContent("R$ 600,00");
    expect(items[0]).toHaveTextContent("60%");
    expect(items[0].querySelector("span")).toHaveStyle({ backgroundColor: "var(--chart-primary)" });
  });

  it("total e rotulo no centro", () => {
    renderDonut(base, { centerLabel: "Total do mês", centerValue: "R$ 1.000,00" });
    expect(screen.getByText("Total do mês")).toBeInTheDocument();
    expect(screen.getByText("R$ 1.000,00", { selector: "span.font-semibold" })).toBeInTheDocument();
  });

  it("sem centro informado, nada e escrito no centro", () => {
    const { container } = renderDonut(base);
    expect(container.querySelector(".font-semibold")).toBeNull();
  });

  it("uma fatia com o percentual arredondado para 0 aparece como '<1%'", () => {
    renderDonut([
      { key: "a", label: "A", value: "100000.00" },
      { key: "b", label: "B", value: "1.00" },
    ]);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[2]).getAllByRole("cell")[1]).toHaveTextContent("<1%");
    expect(within(rows[1]).getAllByRole("cell")[1]).toHaveTextContent("100%");
  });

  it("as fatias sao proporcionais: o arco da maior e o dobro da metade", () => {
    const { container } = renderDonut([
      { key: "a", label: "A", value: "50" },
      { key: "b", label: "B", value: "25" },
      { key: "c", label: "C", value: "25" },
    ]);
    // Arco grande so quando passa de meia volta; 50% e exatamente meia volta (arco pequeno)
    const a = container.querySelector("[data-slice='a']")?.getAttribute("d") ?? "";
    expect(a).toContain("A92 92 0 0 1");
    expect(container.querySelector("[data-slice='b']")?.getAttribute("d")).toContain("A92 92 0 0 1");
  });

  it("o furo da rosca tem raio 58", () => {
    const { container } = renderDonut(base);
    expect(container.querySelector("[data-slice='mercado']")?.getAttribute("d")).toContain("A58 58");
  });

  it("so o rotulo ou so o valor no centro tambem aparecem, sem escrever undefined", () => {
    const first = renderDonut(base, { centerLabel: "Total do mês" });
    expect(screen.getByText("Total do mês")).toBeInTheDocument();
    expect(first.container.innerHTML).not.toMatch(/undefined/);
    first.unmount();
    const second = renderDonut(base, { centerValue: "R$ 1.000,00" });
    expect(screen.getByText("R$ 1.000,00", { selector: "span.font-semibold" })).toBeInTheDocument();
    expect(second.container.innerHTML).not.toMatch(/undefined/);
  });

  it("fatia acima de 50% usa arco grande", () => {
    const { container } = renderDonut([
      { key: "a", label: "A", value: "60" },
      { key: "b", label: "B", value: "40" },
    ]);
    expect(container.querySelector("[data-slice='a']")?.getAttribute("d")).toContain("A92 92 0 1 1");
  });
});

describe("DonutChart: porcentagens coerentes", () => {
  it("tres fatias iguais mostram 34, 33 e 33 (soma 100)", () => {
    renderDonut([
      { key: "a", label: "A", value: "10" },
      { key: "b", label: "B", value: "10" },
      { key: "c", label: "C", value: "10" },
    ]);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    const texts = [1, 2, 3].map((i) => within(rows[i]).getAllByRole("cell")[1].textContent);
    expect(texts).toEqual(["34%", "33%", "33%"]);
  });

  it("seis fatias iguais somam 100 na legenda", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((key) => ({ key, label: key.toUpperCase(), value: "5.00" }));
    renderDonut(six);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const sum = rows.reduce((acc, row) => acc + parseInt(within(row).getAllByRole("cell")[1].textContent ?? "0", 10), 0);
    expect(sum).toBe(100);
  });
});

describe("DonutChart: agrupamento e filtros", () => {
  const many: DonutSlice[] = Array.from({ length: 9 }, (_, i) => ({
    key: `k${i}`,
    label: `Categoria ${i + 1}`,
    value: String((9 - i) * 10),
  }));

  it("padrao 6: mostra 5 fatias e Outras com a soma das menores", () => {
    const { container } = renderDonut(many);
    const items = within(legendOf(container)).getAllByRole("listitem", { hidden: true });
    expect(items).toHaveLength(6);
    expect(items[5]).toHaveTextContent("Outras");
    // Restantes: 40 + 30 + 20 + 10 = 100
    expect(items[5]).toHaveTextContent("R$ 100,00");
    expect(items[5].querySelector("span")).toHaveStyle({ backgroundColor: "var(--chart-muted)" });
  });

  it("maxSlices e otherLabel mudam o agrupamento", () => {
    const { container } = renderDonut(many, { maxSlices: 3, otherLabel: "Demais" });
    const items = within(legendOf(container)).getAllByRole("listitem", { hidden: true });
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent("Demais");
  });

  it("ignora valores zero e negativos", () => {
    const { container } = renderDonut([...base, { key: "z", label: "Zerada", value: "0.00" }, { key: "n", label: "Negativa", value: "-50.00" }]);
    expect(within(legendOf(container)).getAllByRole("listitem", { hidden: true })).toHaveLength(3);
    expect(screen.queryByText("Zerada")).not.toBeInTheDocument();
    expect(screen.queryByText("Negativa")).not.toBeInTheDocument();
  });

  it("cor informada vira o token correspondente; sem cor, segue a lista padrao", () => {
    const { container } = renderDonut([
      { key: "a", label: "A", value: "30", color: "negative" },
      { key: "b", label: "B", value: "20" },
      { key: "c", label: "C", value: "10" },
    ]);
    expect(container.querySelector("[data-slice='a']")).toHaveStyle({ fill: "var(--chart-negative)" });
    // Sem cor: usa a cor da posicao (b e a segunda fatia: accent; c a terceira: warning)
    expect(container.querySelector("[data-slice='b']")).toHaveStyle({ fill: "var(--chart-accent)" });
    expect(container.querySelector("[data-slice='c']")).toHaveStyle({ fill: "var(--chart-warning)" });
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe("DonutChart: bordas", () => {
  it("sem fatias mostra a mensagem de vazio", () => {
    renderDonut([]);
    expect(screen.getByText("Sem dados no período")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Gastos por categoria: sem dados no período" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("so valores zerados ou negativos tambem e vazio", () => {
    renderDonut([{ key: "a", label: "A", value: "0" }, { key: "b", label: "B", value: "-3" }]);
    expect(screen.getByText("Sem dados no período")).toBeInTheDocument();
  });

  it("uma fatia unica de 100% desenha o anel inteiro (dois contornos) sem NaN", () => {
    const { container } = renderDonut([{ key: "a", label: "Unica", value: "250.00" }]);
    const d = container.querySelector("[data-slice='a']")?.getAttribute("d") ?? "";
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(container.querySelector("[data-slice='a']")).toHaveAttribute("fill-rule", "evenodd");
    expect(d).not.toMatch(/ 0 0 0 0 0 /);
    expectNoBrokenNumbers(container);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[1]).getAllByRole("cell")[1]).toHaveTextContent("100%");
  });

  it("valores muito grandes e muito pequenos juntos nao geram NaN", () => {
    const { container } = renderDonut([
      { key: "a", label: "A", value: "99999999999999999999999.99" },
      { key: "b", label: "B", value: "0.01" },
    ]);
    expectNoBrokenNumbers(container);
  });

  it("texto invalido e ignorado, sem NaN", () => {
    const { container } = renderDonut([{ key: "a", label: "A", value: "abc" }, ...base]);
    expect(within(legendOf(container)).getAllByRole("listitem", { hidden: true })).toHaveLength(3);
    expectNoBrokenNumbers(container);
  });

  it("className e aplicado e nao ha animacao", () => {
    const { container } = renderDonut(base, { className: "minha-classe" });
    expect(container.firstElementChild).toHaveClass("minha-classe");
    expect(container.innerHTML).not.toMatch(/<animate|transition|animation/i);
  });
});

describe("DonutChart: teclado e tooltip", () => {
  it("cada fatia e focavel e tem aria-label 'nome: valor (percentual)'", () => {
    const { container } = renderDonut(base);
    const hits = container.querySelectorAll("[data-hit]");
    expect(hits).toHaveLength(3);
    hits.forEach((hit) => expect(hit).toHaveAttribute("tabindex", "0"));
    expect(screen.getByLabelText("Mercado: R$ 600,00 (60%)")).toBeInTheDocument();
    expect(screen.getByLabelText("Lazer: R$ 100,00 (10%)")).toBeInTheDocument();
  });

  it("o foco por teclado mostra o tooltip; sair ou Escape esconde", async () => {
    const user = userEvent.setup();
    renderDonut(base);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Mercado");
    expect(screen.getByRole("tooltip")).toHaveTextContent("R$ 600,00 (60%)");
    await user.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Moradia");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Lazer");
    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("o mouse mostra e esconde o tooltip", async () => {
    const user = userEvent.setup();
    renderDonut(base);
    const slice = screen.getByLabelText("Lazer: R$ 100,00 (10%)");
    await user.hover(slice);
    expect(screen.getByRole("tooltip")).toHaveTextContent("R$ 100,00 (10%)");
    await user.unhover(slice);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("o tooltip da fatia do meio do desenho fica centralizado nela", async () => {
    const user = userEvent.setup();
    renderDonut(base);
    await user.hover(screen.getByLabelText("Lazer: R$ 100,00 (10%)"));
    expect(screen.getByRole("tooltip").style.transform).toContain("-50%");
  });

  it("a fatia em foco fica um pouco maior", async () => {
    const user = userEvent.setup();
    const { container } = renderDonut(base);
    expect(container.querySelector("[data-slice='mercado']")?.getAttribute("d")).toContain("A92 92");
    await user.tab();
    expect(container.querySelector("[data-slice='mercado']")?.getAttribute("d")).toContain("A96 96");
    expect(container.querySelector("[data-slice='moradia']")?.getAttribute("d")).toContain("A92 92");
  });

  it("o tooltip fica dentro da area (porcentagens entre 0 e 100)", async () => {
    const user = userEvent.setup();
    renderDonut(base);
    await user.tab();
    const style = screen.getByRole("tooltip").style;
    for (const value of [parseFloat(style.left), parseFloat(style.top)]) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(100);
    }
  });

  it("a camada das fatias e um grupo nomeado com o titulo", () => {
    renderDonut(base);
    expect(screen.getByRole("group", { name: "Fatias de Gastos por categoria" })).toBeInTheDocument();
  });
});

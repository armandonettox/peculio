import { describe, expect, it } from "vitest";

import type { MonthlyBlock, ReportRow } from "@/api/reports";
import { barWidth, measureValue, monthItems, monthPoints, monthRows, rankRows, topWithOthers, type RankedItem } from "./custom-data";

const row = (name: string, expense: string, income = "0.00", id: string | null = name): ReportRow => ({
  id,
  name,
  expense,
  income,
  net: (Number(income) - Number(expense)).toFixed(2),
  count: 1,
});

const item = (label: string, value: string): RankedItem => ({ key: label, label, value, isOther: false });

describe("measureValue", () => {
  const amounts = { income: "300.00", expense: "120.00", net: "180.00" };
  it.each([
    ["expense", "120.00"],
    ["income", "300.00"],
    ["net", "180.00"],
  ] as const)("%s", (measure, expected) => expect(measureValue(amounts, measure)).toBe(expected));
});

describe("rankRows", () => {
  it("ordena da maior para a menor na medida escolhida", () => {
    const rows = [row("A", "10.00", "500.00"), row("B", "300.00"), row("C", "50.00", "20.00")];
    expect(rankRows(rows, "expense", "x").map((i) => i.label)).toEqual(["B", "C", "A"]);
    expect(rankRows(rows, "income", "x").map((i) => i.label)).toEqual(["A", "C"]);
  });

  it("some quem tem zero na medida", () => {
    const rows = [row("So receita", "0.00", "100.00"), row("So despesa", "40.00")];
    expect(rankRows(rows, "expense", "x").map((i) => i.label)).toEqual(["So despesa"]);
    expect(rankRows(rows, "income", "x").map((i) => i.label)).toEqual(["So receita"]);
  });

  it("no saldo, ordena pelo valor absoluto e mantem o sinal", () => {
    const rows = [row("Pequeno", "5.00", "0.00"), row("Grande negativo", "900.00"), row("Medio positivo", "0.00", "300.00")];
    const ranked = rankRows(rows, "net", "x");
    expect(ranked.map((i) => i.label)).toEqual(["Grande negativo", "Medio positivo", "Pequeno"]);
    expect(ranked.map((i) => i.value)).toEqual(["-900.00", "300.00", "-5.00"]);
  });

  it("saldo zero nao aparece", () => {
    expect(rankRows([row("Zerado", "50.00", "50.00")], "net", "x")).toEqual([]);
  });

  it("empate pelo nome", () => {
    const rows = [row("Zeta", "10.00"), row("Alfa", "10.00"), row("Meio", "10.00")];
    expect(rankRows(rows, "expense", "x").map((i) => i.label)).toEqual(["Alfa", "Meio", "Zeta"]);
  });

  it("a linha sem categoria usa o texto de sem", () => {
    const ranked = rankRows([row("ignorado", "10.00", "0.00", null)], "expense", "Sem categoria");
    expect(ranked).toEqual([{ key: "none", label: "Sem categoria", value: "10.00", isOther: false }]);
  });

  it("guarda o id como chave", () => {
    expect(rankRows([row("A", "10.00", "0.00", "id-a")], "expense", "x")[0].key).toBe("id-a");
  });

  it("lista vazia", () => {
    expect(rankRows([], "expense", "x")).toEqual([]);
  });
});

describe("topWithOthers", () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => item(`G${index + 1}`, `${count - index}0.00`));

  it("ate o limite mostra todos", () => {
    expect(topWithOthers(many(10), "BRL")).toHaveLength(10);
    expect(topWithOthers(many(3), "BRL")).toHaveLength(3);
  });

  it("com um so grupo a mais, mostra todos com o proprio nome", () => {
    const shown = topWithOthers(many(11), "BRL");
    expect(shown).toHaveLength(11);
    expect(shown.some((i) => i.isOther)).toBe(false);
  });

  it("com dois a mais, junta o resto em Outros com a soma exata", () => {
    const items = [...many(10), item("Onze", "7.10"), item("Doze", "0.20")];
    const shown = topWithOthers(items, "BRL");
    expect(shown).toHaveLength(11);
    expect(shown.slice(0, 10).map((i) => i.label)).toEqual(items.slice(0, 10).map((i) => i.label));
    expect(shown[10]).toEqual({ key: "others", label: "Outros", value: "7.30", isOther: true });
  });

  it("o resto soma sem erro de ponto flutuante", () => {
    const items = [...many(10), item("a", "0.10"), item("b", "0.20"), item("c", "0.30")];
    expect(topWithOthers(items, "BRL")[10].value).toBe("0.60");
  });

  it("o resto respeita as casas da moeda", () => {
    const items = [...many(10), item("a", "1"), item("b", "2")];
    expect(topWithOthers(items, "JPY")[10].value).toBe("3");
  });

  it("o resto soma sinais no saldo", () => {
    const items = [...many(10), item("a", "-5.00"), item("b", "2.00")];
    expect(topWithOthers(items, "BRL")[10].value).toBe("-3.00");
  });

  it("aceita outro limite", () => {
    const shown = topWithOthers(many(6), "BRL", 3);
    expect(shown.map((i) => i.label)).toEqual(["G1", "G2", "G3", "Outros"]);
  });
});

describe("barWidth", () => {
  const items = [item("A", "200.00"), item("B", "50.00"), item("C", "-100.00"), item("D", "0.00")];
  it.each([
    ["200.00", 100],
    ["50.00", 25],
    ["-100.00", 50],
    ["0.00", 0],
  ])("%s", (value, expected) => expect(barWidth(value, items)).toBe(expected));

  it("valor pequeno ainda aparece", () => {
    expect(barWidth("0.01", [item("A", "1000.00")])).toBe(1);
  });

  it("lista sem valor positivo nao desenha barra", () => {
    expect(barWidth("0.00", [item("A", "0.00")])).toBe(0);
  });
});

describe("serie por mes", () => {
  const block: MonthlyBlock = {
    currency_code: "BRL",
    months: [
      { month: "2026-01", income: "100.00", expense: "40.00", net: "60.00", count: 3 },
      { month: "2026-02", income: "0.00", expense: "80.00", net: "-80.00", count: 1 },
    ],
  };

  it("pontos na medida escolhida, na ordem do servidor", () => {
    expect(monthPoints(block, "expense")).toEqual([
      { x: "2026-01", value: "40.00" },
      { x: "2026-02", value: "80.00" },
    ]);
    expect(monthPoints(block, "income").map((p) => p.value)).toEqual(["100.00", "0.00"]);
    expect(monthPoints(block, "net").map((p) => p.value)).toEqual(["60.00", "-80.00"]);
  });

  it("meses sem movimento continuam na serie", () => {
    expect(monthPoints({ ...block, months: [{ month: "2026-03", income: "0.00", expense: "0.00", net: "0.00", count: 0 }] }, "expense")).toEqual([
      { x: "2026-03", value: "0.00" },
    ]);
  });

  it("linhas da tabela com o mes por extenso", () => {
    const rows = monthRows(block);
    expect(rows.map((r) => r.name)).toEqual(["janeiro de 2026", "fevereiro de 2026"]);
    expect(rows.map((r) => r.id)).toEqual(["2026-01", "2026-02"]);
    expect(rows[1]).toMatchObject({ income: "0.00", expense: "80.00", net: "-80.00", count: 1 });
  });
});

describe("monthItems", () => {
  const block: MonthlyBlock = {
    currency_code: "BRL",
    months: [
      { month: "2026-03", income: "0.00", expense: "80.00", net: "-80.00", count: 1 },
      { month: "2026-01", income: "100.00", expense: "40.00", net: "60.00", count: 3 },
      { month: "2026-02", income: "0.00", expense: "0.00", net: "0.00", count: 0 },
    ],
  };

  it("fica na ordem do servidor (do tempo), nao do tamanho, e mantem o mes vazio", () => {
    const items = monthItems(block, "expense");
    expect(items.map((i) => i.label)).toEqual(["mar/26", "jan/26", "fev/26"]);
    expect(items.map((i) => i.value)).toEqual(["80.00", "40.00", "0.00"]);
    expect(items.every((i) => !i.isOther)).toBe(true);
  });

  it("usa a medida escolhida e o mes como chave", () => {
    expect(monthItems(block, "net").map((i) => i.value)).toEqual(["-80.00", "60.00", "0.00"]);
    expect(monthItems(block, "income")[1]).toMatchObject({ key: "2026-01", value: "100.00" });
  });
});

import { describe, expect, it } from "vitest";

import type { SavedReport } from "@/api/saved-reports";
import {
  allowedCharts,
  chartAllowed,
  chartLabel,
  configError,
  DEFAULT_CONFIG,
  fromSaved,
  groupByLabel,
  measureLabel,
  missingFilters,
  normalize,
  periodError,
  periodLabel,
  reportTitle,
  sameConfig,
  toApiFilters,
  toBody,
  type CustomConfig,
} from "./custom-config";

const config = (overrides: Partial<CustomConfig> = {}): CustomConfig => ({ ...DEFAULT_CONFIG, ...overrides });

describe("regras da combinacao (iguais as do servidor)", () => {
  it.each([
    ["month", "line", "expense", true],
    ["month", "line", "net", true],
    ["month", "bar", "net", true],
    ["month", "table", "income", true],
    ["category", "line", "expense", false],
    ["account", "line", "income", false],
    ["month", "donut", "expense", false],
    ["category", "donut", "net", false],
    ["category", "donut", "expense", true],
    ["counterparty", "donut", "income", true],
    ["tag", "bar", "net", true],
    ["budget", "table", "net", true],
  ] as const)("%s com %s e %s", (groupBy, chart, measure, ok) => {
    expect(chartAllowed(groupBy, chart, measure)).toBe(ok);
    expect(configError(groupBy, chart, measure) === null).toBe(ok);
  });

  it("explica por que nao serve", () => {
    expect(configError("category", "line", "expense")).toContain("linha");
    expect(configError("month", "donut", "expense")).toContain("mês");
    expect(configError("category", "donut", "net")).toContain("saldo");
  });

  it("lista os graficos que servem, na ordem do seletor", () => {
    expect(allowedCharts("category", "expense")).toEqual(["table", "bar", "donut"]);
    expect(allowedCharts("category", "net")).toEqual(["table", "bar"]);
    expect(allowedCharts("month", "expense")).toEqual(["table", "bar", "line"]);
  });

  it("a tabela serve para tudo", () => {
    for (const groupBy of ["category", "tag", "budget", "account", "counterparty", "month"] as const) {
      for (const measure of ["expense", "income", "net"] as const) expect(chartAllowed(groupBy, "table", measure)).toBe(true);
    }
  });
});

describe("normalize", () => {
  it("mantem o grafico quando serve", () => {
    const current = config({ chart: "donut" });
    expect(normalize(current)).toBe(current);
  });

  it("de rosca para mes vira linha", () => {
    expect(normalize(config({ chart: "donut", groupBy: "month" })).chart).toBe("line");
  });

  it("de linha para categoria vira barras", () => {
    expect(normalize(config({ chart: "line", groupBy: "category" })).chart).toBe("bar");
  });

  it("de rosca para saldo vira barras", () => {
    expect(normalize(config({ chart: "donut", measure: "net" })).chart).toBe("bar");
  });

  it("nao mexe no resto", () => {
    const next = normalize(config({ chart: "line", groupBy: "tag", categoryId: "c1", period: "this-year" }));
    expect(next).toMatchObject({ groupBy: "tag", categoryId: "c1", period: "this-year" });
  });
});

describe("periodo", () => {
  it("periodo pronto nunca tem erro, mesmo com datas sobrando", () => {
    expect(periodError(config({ period: "this-month", dateFrom: "2026-02-01", dateTo: "2026-01-01" }))).toBeUndefined();
  });

  it.each([
    [{ dateFrom: "", dateTo: "" }, "Informe as duas datas."],
    [{ dateFrom: "2026-01-01", dateTo: "" }, "Informe as duas datas."],
    [{ dateFrom: "", dateTo: "2026-01-01" }, "Informe as duas datas."],
    [{ dateFrom: "2026-02-01", dateTo: "2026-01-01" }, "A data inicial é depois da data final."],
    [{ dateFrom: "2026-01-01", dateTo: "2026-01-01" }, undefined],
    [{ dateFrom: "2026-01-01", dateTo: "2026-03-31" }, undefined],
  ])("datas fixas %j", (dates, expected) => {
    expect(periodError(config({ period: "fixed", ...dates }))).toBe(expected);
  });
});

describe("toApiFilters", () => {
  it("periodo pronto vai como period e as datas guardadas nao vao", () => {
    expect(toApiFilters(config({ period: "last-3-months", dateFrom: "2026-01-01", dateTo: "2026-02-01" }))).toEqual({
      period: "last-3-months",
    });
  });

  it("datas fixas vao como datas e sem period", () => {
    expect(toApiFilters(config({ period: "fixed", dateFrom: "2026-01-01", dateTo: "2026-03-31" }))).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-03-31",
    });
  });

  it("so manda os filtros ligados", () => {
    expect(toApiFilters(config({ accountId: "a1", tagId: "t1" }))).toEqual({ period: "this-month", accountId: "a1", tagId: "t1" });
    expect(toApiFilters(config({ categoryId: "c1", budgetId: "b1" }))).toEqual({
      period: "this-month",
      categoryId: "c1",
      budgetId: "b1",
    });
  });
});

describe("salvar e abrir", () => {
  const saved: SavedReport = {
    id: "r1",
    name: "Gastos",
    group_by: "tag",
    chart: "bar",
    measure: "net",
    period: "fixed",
    date_from: "2026-01-01",
    date_to: "2026-03-31",
    account_id: "a1",
    category_id: null,
    tag_id: "t1",
    budget_id: null,
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
  };

  it("abre um relatorio salvo", () => {
    expect(fromSaved(saved)).toEqual({
      groupBy: "tag",
      chart: "bar",
      measure: "net",
      period: "fixed",
      dateFrom: "2026-01-01",
      dateTo: "2026-03-31",
      accountId: "a1",
      categoryId: "",
      tagId: "t1",
      budgetId: "",
    });
  });

  it("o relatorio de periodo pronto abre sem datas", () => {
    const next = fromSaved({ ...saved, period: "this-year", date_from: null, date_to: null });
    expect(next).toMatchObject({ period: "this-year", dateFrom: "", dateTo: "" });
  });

  it("ida e volta devolve a mesma configuracao", () => {
    const original = fromSaved(saved);
    const body = toBody(original, "Gastos");
    expect(fromSaved({ ...saved, ...body, date_from: body.date_from ?? null, date_to: body.date_to ?? null } as SavedReport)).toEqual(original);
  });

  it("o corpo apara o nome e manda null nos filtros desligados", () => {
    expect(toBody(config({ categoryId: "c1" }), "  Mensal  ")).toEqual({
      name: "Mensal",
      group_by: "category",
      chart: "donut",
      measure: "expense",
      period: "this-month",
      account_id: null,
      category_id: "c1",
      tag_id: null,
      budget_id: null,
    });
  });

  it("o corpo so leva as datas no periodo fixo", () => {
    expect(toBody(config({ period: "this-year", dateFrom: "2026-01-01", dateTo: "2026-02-01" }), "x")).not.toHaveProperty("date_from");
    expect(toBody(config({ period: "fixed", dateFrom: "2026-01-01", dateTo: "2026-02-01" }), "x")).toMatchObject({
      date_from: "2026-01-01",
      date_to: "2026-02-01",
    });
  });
});

describe("sameConfig", () => {
  it("igual", () => expect(sameConfig(config(), config())).toBe(true));

  it.each([
    ["agrupar", { groupBy: "tag" }],
    ["grafico", { chart: "bar" }],
    ["medida", { measure: "income" }],
    ["periodo", { period: "this-year" }],
    ["conta", { accountId: "a" }],
    ["categoria", { categoryId: "c" }],
    ["tag", { tagId: "t" }],
    ["orcamento", { budgetId: "b" }],
  ] as const)("mudar %s", (_name, change) => {
    expect(sameConfig(config(), config(change))).toBe(false);
  });

  it("datas soltas nao contam fora do periodo fixo", () => {
    expect(sameConfig(config({ dateFrom: "2026-01-01" }), config({ dateFrom: "2027-01-01" }))).toBe(true);
  });

  it("no periodo fixo as datas contam", () => {
    const base = config({ period: "fixed", dateFrom: "2026-01-01", dateTo: "2026-02-01" });
    expect(sameConfig(base, { ...base, dateFrom: "2026-01-02" })).toBe(false);
    expect(sameConfig(base, { ...base, dateTo: "2026-02-02" })).toBe(false);
    expect(sameConfig(base, { ...base })).toBe(true);
  });
});

describe("missingFilters", () => {
  const known = { accounts: ["a1"], categories: ["c1"], tags: ["t1"], budgets: ["b1"] };

  it("sem filtros nao falta nada", () => expect(missingFilters(config(), known)).toEqual([]));

  it("filtros que existem", () => {
    expect(missingFilters(config({ accountId: "a1", categoryId: "c1", tagId: "t1", budgetId: "b1" }), known)).toEqual([]);
  });

  it("diz qual filtro aponta para algo que sumiu, na ordem da tela", () => {
    expect(missingFilters(config({ accountId: "x", categoryId: "x", tagId: "x", budgetId: "x" }), known)).toEqual([
      "conta",
      "categoria",
      "tag",
      "orçamento",
    ]);
    expect(missingFilters(config({ categoryId: "x", budgetId: "b1" }), known)).toEqual(["categoria"]);
  });

  it("lista ainda nao carregada nao conta como faltando", () => {
    expect(missingFilters(config({ categoryId: "x" }), {})).toEqual([]);
    expect(missingFilters(config({ categoryId: "x" }), { categories: [] })).toEqual(["categoria"]);
  });
});

describe("textos e contagem", () => {
  it("rotulos", () => {
    expect(groupByLabel("counterparty")).toBe("Contraparte");
    expect(measureLabel("net")).toBe("Saldo (receitas menos despesas)");
    expect(chartLabel("donut")).toBe("Rosca");
    expect(periodLabel("last-12-months")).toBe("Últimos 12 meses");
    expect(periodLabel("fixed")).toBe("Datas fixas");
  });

});

describe("reportTitle", () => {
  it.each([
    ["category", "expense", "Despesas por categoria"],
    ["tag", "income", "Receitas por tag"],
    ["counterparty", "net", "Saldo por contraparte"],
    ["budget", "expense", "Despesas por orçamento"],
    ["account", "income", "Receitas por conta"],
    ["month", "expense", "Despesas mês a mês"],
    ["month", "net", "Saldo mês a mês"],
  ] as const)("%s com %s", (groupBy, measure, expected) => expect(reportTitle(groupBy, measure)).toBe(expected));
});

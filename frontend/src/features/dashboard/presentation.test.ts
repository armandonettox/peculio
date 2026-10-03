import { expect, it } from "vitest";

import type { BudgetProgress } from "@/api/budgets";
import type { ReportRow } from "@/api/reports";
import type { UpcomingItem } from "@/api/dashboard";
import { formatMoney } from "@/lib/money";
import {
  buildAlerts,
  categorySlices,
  closestToLimit,
  compareToLastMonth,
  directionText,
  findByCurrency,
  formatDiff,
  formatPercent,
  pickCurrency,
  trendFor,
  upcomingAmountText,
} from "./presentation";

// ---------- Comparacao com o mes passado ----------

it("despesa menor que o mes passado: diferenca negativa, mas e uma tendencia boa", () => {
  const { diff, percent } = compareToLastMonth("400.00", "500.00", 2);
  expect(diff).toBe("-100.00");
  expect(percent).toBe(-20);
  expect(trendFor("expense", diff)).toBe("good");
});

it("despesa maior que o mes passado e uma tendencia ruim", () => {
  const { diff } = compareToLastMonth("600.00", "500.00", 2);
  expect(trendFor("expense", diff)).toBe("bad");
});

it("receita maior e boa; receita menor e ruim", () => {
  expect(trendFor("income", compareToLastMonth("600.00", "500.00", 2).diff)).toBe("good");
  expect(trendFor("income", compareToLastMonth("400.00", "500.00", 2).diff)).toBe("bad");
});

it("sem diferenca nenhuma (zero a zero ou mesmo valor) a tendencia e neutra", () => {
  expect(trendFor("net", compareToLastMonth("0.00", "0.00", 2).diff)).toBe("neutral");
  expect(trendFor("net", compareToLastMonth("300.00", "300.00", 2).diff)).toBe("neutral");
});

it("mes passado zerado: diferenca normal, mas sem percentual (nao divide por zero)", () => {
  const { diff, percent } = compareToLastMonth("300.00", "0.00", 2);
  expect(diff).toBe("300.00");
  expect(percent).toBeNull();
});

it("mes passado ausente (moeda nova) conta como zero", () => {
  const { diff, percent } = compareToLastMonth("150.00", undefined, 2);
  expect(diff).toBe("150.00");
  expect(percent).toBeNull();
});

it("resultado negativo nos dois meses: percentual usa o valor absoluto do mes passado como base", () => {
  const { diff, percent } = compareToLastMonth("-50.00", "-100.00", 2);
  expect(diff).toBe("50.00");
  expect(percent).toBe(50);
});

it("formata a diferenca em dinheiro e o texto quando e igual", () => {
  expect(formatDiff("-100.00", "BRL")).toBe(`${formatMoney("100.00", "BRL")} a menos`);
  expect(formatDiff("100.00", "BRL")).toBe(`${formatMoney("100.00", "BRL")} a mais`);
  expect(formatDiff("0.00", "BRL")).toBe("Igual ao mês passado");
});

it("formata o percentual com sinal, uma casa decimal, ou a frase de sem base", () => {
  expect(formatPercent(-20)).toBe("-20,0%");
  expect(formatPercent(12.34)).toBe("+12,3%");
  expect(formatPercent(0)).toBe("0,0%");
  expect(formatPercent(null)).toBe("Sem base de comparação");
});

it("acha os totais da mesma moeda no outro periodo, ou nada se ela nao existia", () => {
  const list = [{ currency_code: "USD", income: "1", expense: "1", net: "0", count: 1 }];
  expect(findByCurrency(list, "USD")?.currency_code).toBe("USD");
  expect(findByCurrency(list, "BRL")).toBeUndefined();
});

// ---------- Moeda escolhida ----------

it("mantem a moeda escolhida se ela ainda esta na lista, senao usa a primeira", () => {
  const blocks = [{ currency_code: "BRL" }, { currency_code: "USD" }];
  expect(pickCurrency(blocks, "USD")).toBe("USD");
  expect(pickCurrency(blocks, "JPY")).toBe("BRL");
  expect(pickCurrency(blocks, null)).toBe("BRL");
  expect(pickCurrency([], "BRL")).toBeNull();
});

// ---------- Categorias ----------

function row(overrides: Partial<ReportRow>): ReportRow {
  return { id: "c1", name: "Categoria", income: "0.00", expense: "0.00", net: "0.00", count: 1, ...overrides };
}

it("so entram categorias com gasto positivo, da maior para a menor", () => {
  const rows = [
    row({ id: "a", name: "Mercado", expense: "100.00" }),
    row({ id: "b", name: "Lazer", expense: "300.00" }),
    row({ id: "c", name: "Reembolso", expense: "-20.00" }),
    row({ id: "d", name: "Zerada", expense: "0.00" }),
    row({ id: null, name: "", expense: "50.00" }),
  ];
  expect(categorySlices(rows, "Sem categoria")).toEqual([
    { key: "b", label: "Lazer", value: "300.00" },
    { key: "a", label: "Mercado", value: "100.00" },
    { key: "__sem_categoria__", label: "Sem categoria", value: "50.00" },
  ]);
});

// ---------- Orcamentos ----------

function budget(overrides: Partial<BudgetProgress>): BudgetProgress {
  return {
    id: "b1",
    name: "Orcamento",
    currency_code: "BRL",
    amount: "100.00",
    period: "monthly",
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    period_start: "2026-03-01",
    period_end: "2026-03-31",
    spent: "0.00",
    remaining: "100.00",
    percent: 0,
    ...overrides,
  };
}

it("pega os 4 mais perto do limite, do maior percentual para o menor", () => {
  const items = [10, 90, 50, 100, 30, 95].map((percent) => budget({ id: String(percent), percent }));
  expect(closestToLimit(items).map((item) => item.percent)).toEqual([100, 95, 90, 50]);
});

// ---------- Proximos vencimentos ----------

it("mostra um valor so quando minimo e maximo sao iguais, senao a faixa", () => {
  const base = { currency_code: "BRL" };
  expect(upcomingAmountText({ ...base, amount_min: "49.90", amount_max: "49.90" })).toBe(formatMoney("49.90", "BRL"));
  expect(upcomingAmountText({ ...base, amount_min: "40.00", amount_max: "60.00" })).toBe(
    `${formatMoney("40.00", "BRL")} a ${formatMoney("60.00", "BRL")}`,
  );
});

it("traduz a direcao do vencimento", () => {
  expect(directionText("in")).toBe("Entra");
  expect(directionText("out")).toBe("Sai");
  expect(directionText("transfer")).toBe("Transferência");
});

// ---------- Alertas ----------

function upcomingItem(overrides: Partial<UpcomingItem>): UpcomingItem {
  return {
    kind: "bill",
    id: "u1",
    name: "Conta",
    date: "2026-03-20",
    days_until: 5,
    overdue: false,
    direction: "out",
    currency_code: "BRL",
    amount_min: "40.00",
    amount_max: "40.00",
    ...overrides,
  };
}

it("sem nada atrasado nem perto do limite, nao ha alerta", () => {
  expect(buildAlerts([], [])).toEqual([]);
});

it("junta contas atrasadas e orcamentos por gravidade, mais graves primeiro", () => {
  const upcoming = [upcomingItem({ overdue: true }), upcomingItem({ overdue: true }), upcomingItem({ overdue: false })];
  const budgets = [budget({ percent: 100 }), budget({ percent: 85 })];
  expect(buildAlerts(upcoming, budgets)).toEqual([
    { key: "overdue", text: "2 contas atrasadas", href: "/contas-a-pagar", level: "destructive" },
    { key: "over", text: "1 orçamento no limite", href: "/orcamentos", level: "destructive" },
    { key: "warning", text: "1 orçamento perto do limite (acima de 80%)", href: "/orcamentos", level: "warning" },
  ]);
});

it("nao confunde perto do limite com no limite: so quem passou de 100% conta como 'no limite'", () => {
  const budgets = [budget({ percent: 85 }), budget({ percent: 90 })];
  expect(buildAlerts([], budgets)).toEqual([
    { key: "warning", text: "2 orçamentos perto do limite (acima de 80%)", href: "/orcamentos", level: "warning" },
  ]);
});

it("uma conta atrasada e um orcamento no limite usam o singular", () => {
  const alerts = buildAlerts([upcomingItem({ overdue: true })], [budget({ percent: 100 })]);
  expect(alerts[0].text).toBe("1 conta atrasada");
  expect(alerts[1].text).toBe("1 orçamento no limite");
});

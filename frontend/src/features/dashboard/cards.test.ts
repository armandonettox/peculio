import { beforeEach, expect, it } from "vitest";

import { defaultLayout, moveCard, moveCardBy, orderedColumn, readLayout, writeLayout } from "./cards";

beforeEach(() => window.localStorage.clear());

it("sem escolha salva vale o padrao", () => {
  expect(readLayout()).toEqual(defaultLayout());
});

it("a escolha salva volta igual, inclusive quando desliga tudo", () => {
  const layout = { ...defaultLayout(), enabled: ["calendar" as const, "profile" as const] };
  writeLayout(layout);
  expect(readLayout()).toEqual(layout);
  writeLayout({ ...layout, enabled: [] });
  expect(readLayout().enabled).toEqual([]);
});

it("nome de bloco que nao existe mais e repeticao sao ignorados", () => {
  window.localStorage.setItem(
    "peculio.dashboard.layout",
    JSON.stringify({ enabled: ["calendar", "bloco-antigo", 7, "calendar"], order: ["accounts", "bloco-antigo", "expensesByCategory"] }),
  );
  const layout = readLayout();
  expect(layout.enabled).toEqual(["calendar"]);
  // Bloco que a ordem salva nao conhece entra no fim da coluna dele
  expect(orderedColumn(layout.order, "left").slice(0, 2)).toEqual(["accounts", "expensesByCategory"]);
  expect(layout.order).toHaveLength(defaultLayout().order.length);
});

it("valor ilegivel cai no padrao", () => {
  window.localStorage.setItem("peculio.dashboard.layout", "isto nao e json");
  expect(readLayout()).toEqual(defaultLayout());
  window.localStorage.setItem("peculio.dashboard.layout", JSON.stringify({ enabled: "x" }));
  expect(readLayout()).toEqual(defaultLayout());
});

it("a escolha da versao anterior (so a lista de ligados) continua valendo, com a ordem padrao", () => {
  window.localStorage.setItem("peculio.dashboard.cards", JSON.stringify(["profile"]));
  expect(readLayout()).toEqual({ ...defaultLayout(), enabled: ["profile"] });
});

it("arrastar leva o bloco para o lugar do alvo, nos dois sentidos", () => {
  const order = defaultLayout().order;
  const down = moveCard(order, "expensesByCategory", "monthlyBalance");
  expect(orderedColumn(down, "left").slice(0, 3)).toEqual(["spendingFrequency", "monthlyBalance", "expensesByCategory"]);
  const up = moveCard(order, "monthlyBalance", "expensesByCategory");
  expect(orderedColumn(up, "left").slice(0, 3)).toEqual(["monthlyBalance", "expensesByCategory", "spendingFrequency"]);
});

it("soltar numa coluna diferente ou no proprio bloco nao muda nada", () => {
  const order = defaultLayout().order;
  expect(moveCard(order, "expensesByCategory", "incomeByCategory")).toBe(order);
  expect(moveCard(order, "expensesByCategory", "expensesByCategory")).toBe(order);
});

it("mexer numa coluna nao mexe na outra", () => {
  const order = defaultLayout().order;
  const next = moveCard(order, "profile", "incomeByCategory");
  expect(orderedColumn(next, "left")).toEqual(orderedColumn(order, "left"));
  expect(orderedColumn(next, "right")[0]).toBe("profile");
});

it("subir e descer andam uma posicao e param nas pontas", () => {
  const order = defaultLayout().order;
  expect(orderedColumn(moveCardBy(order, "spendingFrequency", -1), "left")[0]).toBe("spendingFrequency");
  expect(moveCardBy(order, "expensesByCategory", -1)).toBe(order);
  const last = orderedColumn(order, "left").at(-1)!;
  expect(moveCardBy(order, last, 1)).toBe(order);
});

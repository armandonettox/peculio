import { beforeEach, expect, it } from "vitest";

import { defaultLayout, flatCards, moveCard, moveFlat, moveFlatBy, moveFlatToEnd, moveCardBy, moveCardToColumn, moveCardToOtherColumn, readLayout, writeLayout } from "./cards";

beforeEach(() => window.localStorage.clear());

const KEY = "peculio.dashboard.layout";

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

it("nome de bloco que nao existe mais e repeticao sao ignorados, e o que falta entra na coluna de fabrica", () => {
  window.localStorage.setItem(
    KEY,
    JSON.stringify({ enabled: ["calendar", "bloco-antigo", 7, "calendar"], left: ["accounts", "bloco-antigo", "profile"], right: ["accounts", "goals"] }),
  );
  const layout = readLayout();
  expect(layout.enabled).toEqual(["calendar"]);
  // "profile" e de fabrica da direita, mas foi salvo na esquerda: fica onde a pessoa deixou; "accounts" repetido fica so na esquerda
  expect(layout.left.slice(0, 2)).toEqual(["accounts", "profile"]);
  expect(layout.right[0]).toBe("goals");
  expect([...layout.left, ...layout.right].sort()).toEqual([...defaultLayout().left, ...defaultLayout().right].sort());
});

it("valor ilegivel cai no padrao", () => {
  window.localStorage.setItem(KEY, "isto nao e json");
  expect(readLayout()).toEqual(defaultLayout());
  window.localStorage.setItem(KEY, JSON.stringify({ enabled: "x" }));
  expect(readLayout()).toEqual(defaultLayout());
});

it("a escolha do formato com uma ordem so continua valendo", () => {
  window.localStorage.setItem(KEY, JSON.stringify({ enabled: ["calendar"], order: ["monthlyBalance", "expensesByCategory", "goals", "incomeByCategory"] }));
  const layout = readLayout();
  expect(layout.left.slice(0, 2)).toEqual(["monthlyBalance", "expensesByCategory"]);
  expect(layout.right.slice(0, 2)).toEqual(["goals", "incomeByCategory"]);
});

it("a escolha da primeira versao (so a lista de ligados) continua valendo, com a ordem padrao", () => {
  window.localStorage.setItem("peculio.dashboard.cards", JSON.stringify(["profile"]));
  expect(readLayout()).toEqual({ ...defaultLayout(), enabled: ["profile"] });
});

it("arrastar na mesma coluna leva o bloco para o lugar do alvo, nos dois sentidos", () => {
  const layout = defaultLayout();
  expect(moveCard(layout, "expensesByCategory", "monthlyBalance").left.slice(0, 3)).toEqual(["spendingFrequency", "monthlyBalance", "expensesByCategory"]);
  expect(moveCard(layout, "monthlyBalance", "expensesByCategory").left.slice(0, 3)).toEqual(["monthlyBalance", "expensesByCategory", "spendingFrequency"]);
});

it("arrastar para a outra coluna tira o bloco de la e poe no lugar do alvo", () => {
  const next = moveCard(defaultLayout(), "expensesByCategory", "quarterBalance");
  expect(next.left).not.toContain("expensesByCategory");
  expect(next.right.slice(0, 3)).toEqual(["incomeByCategory", "semesterBalance", "expensesByCategory"]);
  // Cada bloco continua em uma coluna so
  expect(next.left.length + next.right.length).toBe(defaultLayout().left.length + defaultLayout().right.length);
  // E o caminho de volta
  const back = moveCard(next, "expensesByCategory", "spendingFrequency");
  expect(back.left.slice(0, 2)).toEqual(["expensesByCategory", "spendingFrequency"]);
  expect(back.right).not.toContain("expensesByCategory");
});

it("soltar no proprio bloco nao muda nada", () => {
  const layout = defaultLayout();
  expect(moveCard(layout, "expensesByCategory", "expensesByCategory")).toBe(layout);
});

it("soltar numa coluna (vazia ou abaixo do ultimo) leva o bloco para o fim dela", () => {
  const layout = defaultLayout();
  expect(moveCardToColumn(layout, "expensesByCategory", "right").right.at(-1)).toBe("expensesByCategory");
  expect(moveCardToColumn(layout, "expensesByCategory", "left").left.at(-1)).toBe("expensesByCategory");
  const emptied = { ...layout, left: [], right: [...layout.left, ...layout.right] };
  const back = moveCardToColumn(emptied, "calendar", "left");
  expect(back.left).toEqual(["calendar"]);
  expect(back.right).not.toContain("calendar");
});

it("subir e descer andam uma posicao e param nas pontas", () => {
  const layout = defaultLayout();
  expect(moveCardBy(layout, "spendingFrequency", -1).left[0]).toBe("spendingFrequency");
  expect(moveCardBy(layout, "expensesByCategory", -1)).toBe(layout);
  const last = layout.left.at(-1)!;
  expect(moveCardBy(layout, last, 1)).toBe(layout);
});

it("passar para a outra coluna pelo teclado poe o bloco no fim dela", () => {
  const next = moveCardToOtherColumn(defaultLayout(), "profile");
  expect(next.left.at(-1)).toBe("profile");
  expect(next.right).not.toContain("profile");
  expect(moveCardToOtherColumn(next, "profile").right.at(-1)).toBe("profile");
});

it("lista unica: a ordem e a da esquerda seguida da direita", () => {
  const layout = defaultLayout();
  expect(flatCards(layout)).toEqual([...layout.left, ...layout.right]);
});

it("lista unica: mover reordena a lista inteira e a coluna da esquerda mantem o mesmo tamanho", () => {
  const layout = defaultLayout();
  const next = moveFlat(layout, "expensesByCategory", "incomeByCategory");
  expect(flatCards(next).indexOf("expensesByCategory")).toBe(flatCards(layout).indexOf("incomeByCategory"));
  expect(next.left).toHaveLength(layout.left.length);
  expect(next.right).toHaveLength(layout.right.length);
  expect(moveFlat(layout, "expensesByCategory", "expensesByCategory")).toBe(layout);
});

it("lista unica: descer o ultimo da esquerda troca de lugar com o primeiro da direita", () => {
  const layout = defaultLayout();
  const next = moveFlatBy(layout, "recentTransactions", 1);
  expect(next.left.at(-1)).toBe("incomeByCategory");
  expect(next.right[0]).toBe("recentTransactions");
  expect(moveFlatBy(layout, "expensesByCategory", -1)).toBe(layout);
  expect(moveFlatBy(layout, "netWorth", 1)).toBe(layout);
});

it("lista unica: o fim da lista recebe o bloco solto abaixo do ultimo", () => {
  const next = moveFlatToEnd(defaultLayout(), "expensesByCategory");
  expect(flatCards(next).at(-1)).toBe("expensesByCategory");
  expect(next.left).toHaveLength(defaultLayout().left.length);
});

import { beforeEach, expect, it } from "vitest";

import { defaultCards, readEnabledCards, writeEnabledCards } from "./cards";

beforeEach(() => window.localStorage.clear());

it("sem escolha salva vale o padrao", () => {
  expect(readEnabledCards()).toEqual(defaultCards());
});

it("a escolha salva volta igual, inclusive quando desliga tudo", () => {
  writeEnabledCards(["calendar", "profile"]);
  expect(readEnabledCards()).toEqual(["calendar", "profile"]);
  writeEnabledCards([]);
  expect(readEnabledCards()).toEqual([]);
});

it("nome de bloco que nao existe mais e ignorado", () => {
  window.localStorage.setItem("peculio.dashboard.cards", JSON.stringify(["calendar", "bloco-antigo", 7]));
  expect(readEnabledCards()).toEqual(["calendar"]);
});

it("valor ilegivel cai no padrao", () => {
  window.localStorage.setItem("peculio.dashboard.cards", "{nao e json");
  expect(readEnabledCards()).toEqual(defaultCards());
  window.localStorage.setItem("peculio.dashboard.cards", JSON.stringify({ a: 1 }));
  expect(readEnabledCards()).toEqual(defaultCards());
});

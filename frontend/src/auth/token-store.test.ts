import { expect, it, vi } from "vitest";

import { createTokenStore } from "./token-store";

it("comeca sem token", () => {
  expect(createTokenStore().get()).toBeNull();
});

it("guarda e limpa o token", () => {
  const store = createTokenStore();
  store.set("abc");
  expect(store.get()).toBe("abc");
  store.clear();
  expect(store.get()).toBeNull();
});

it("nunca grava o token no localStorage nem no sessionStorage", () => {
  const store = createTokenStore();
  store.set("segredo-do-token");
  expect(JSON.stringify({ ...localStorage })).not.toContain("segredo-do-token");
  expect(JSON.stringify({ ...sessionStorage })).not.toContain("segredo-do-token");
});

it("avisa quem assinou quando o token muda", () => {
  const store = createTokenStore();
  const listener = vi.fn();
  store.subscribe(listener);

  store.set("a");
  store.clear();

  expect(listener).toHaveBeenNthCalledWith(1, "a");
  expect(listener).toHaveBeenNthCalledWith(2, null);
});

it("limpar sem token nao avisa ninguem", () => {
  const store = createTokenStore();
  const listener = vi.fn();
  store.subscribe(listener);
  store.clear();
  expect(listener).not.toHaveBeenCalled();
});

it("quem cancela a assinatura para de ser avisado", () => {
  const store = createTokenStore();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  unsubscribe();
  store.set("a");
  expect(listener).not.toHaveBeenCalled();
});

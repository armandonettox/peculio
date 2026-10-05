import { describe, expect, it } from "vitest";

import { navAction, nextIndex, SHORTCUT_GROUPS, tabStop, type KeyInfo, type NavAction } from "./table-nav";

const key = (name: string, overrides: Partial<KeyInfo> = {}): KeyInfo => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("navAction", () => {
  it.each([
    ["ArrowDown", { kind: "move", delta: 1 }],
    ["j", { kind: "move", delta: 1 }],
    ["ArrowUp", { kind: "move", delta: -1 }],
    ["k", { kind: "move", delta: -1 }],
    ["Home", { kind: "edge", edge: "first" }],
    ["End", { kind: "edge", edge: "last" }],
    ["t", { kind: "new" }],
    ["Enter", { kind: "open" }],
    [" ", { kind: "select" }],
    ["Escape", { kind: "clear" }],
  ])("%s", (name, expected) => expect(navAction(key(name))).toEqual(expected));

  it.each(["a", "x", "Tab", "J", "K", "T", "1"])("%j nao e da tabela", (name) => {
    expect(navAction(key(name))).toBeNull();
  });

  it.each(["ctrlKey", "metaKey", "altKey"] as const)("com %s apertado fica para o navegador", (modifier) => {
    for (const name of ["j", "k", "t", "ArrowDown", "Enter", "Home", " ", "Escape"]) {
      expect(navAction(key(name, { [modifier]: true }))).toBeNull();
    }
  });

  it("Espaco marca a linha e Shift+Espaco marca o intervalo", () => {
    expect(navAction(key(" "))).toEqual({ kind: "select" });
    expect(navAction(key(" ", { shiftKey: true }))).toEqual({ kind: "range" });
  });

  it.each(["ctrlKey", "metaKey"] as const)("%s com A marca todos", (modifier) => {
    expect(navAction(key("a", { [modifier]: true }))).toEqual({ kind: "all" });
  });

  it("Ctrl+A so vale sem Shift e sem Alt; Ctrl com outra letra e do navegador", () => {
    expect(navAction(key("a", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(navAction(key("a", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(navAction(key("c", { ctrlKey: true }))).toBeNull();
    expect(navAction(key("A", { ctrlKey: true }))).toBeNull();
  });

  it("letra com Shift nao conta, mas a seta com Shift continua andando", () => {
    expect(navAction(key("j", { shiftKey: true }))).toBeNull();
    expect(navAction(key("ArrowDown", { shiftKey: true }))).toEqual({ kind: "move", delta: 1 });
  });
});

describe("nextIndex", () => {
  const down: NavAction = { kind: "move", delta: 1 };
  const up: NavAction = { kind: "move", delta: -1 };

  it.each([
    [0, 5, down, 1],
    [3, 5, down, 4],
    [4, 5, down, 4],
    [4, 5, up, 3],
    [0, 5, up, 0],
    [0, 1, down, 1 - 1],
  ])("de %i em %i linhas com %j vai para %i", (current, count, action, expected) => {
    expect(nextIndex(current, count, action)).toBe(expected);
  });

  it("Home e End", () => {
    expect(nextIndex(3, 5, { kind: "edge", edge: "first" })).toBe(0);
    expect(nextIndex(1, 5, { kind: "edge", edge: "last" })).toBe(4);
  });

  it("sem linhas nao ha para onde ir", () => {
    expect(nextIndex(0, 0, down)).toBeNull();
    expect(nextIndex(0, 0, { kind: "edge", edge: "last" })).toBeNull();
  });

  it("acoes que nao movem ficam na mesma linha (ou na ultima, se a lista encolheu)", () => {
    expect(nextIndex(2, 5, { kind: "open" })).toBe(2);
    expect(nextIndex(2, 5, { kind: "select" })).toBe(2);
    expect(nextIndex(9, 5, { kind: "new" })).toBe(4);
  });
});

describe("tabStop", () => {
  it.each([
    [0, 5, 0],
    [3, 5, 3],
    [9, 5, 4],
    [-2, 5, 0],
    [0, 0, -1],
  ])("ativa %i de %i linhas: parada %i", (active, count, expected) => expect(tabStop(active, count)).toBe(expected));
});

describe("a lista de atalhos", () => {
  const listed = SHORTCUT_GROUPS.flatMap((group) => group.items.flatMap((item) => item.keys));

  it("cada tecla que a tabela trata aparece na lista", () => {
    const handled = ["ArrowDown", "j", "ArrowUp", "k", "Home", "End", "t", "Enter"];
    for (const name of handled) expect(navAction(key(name)), name).not.toBeNull();
    for (const shown of ["↓", "J", "↑", "K", "Home", "End", "T", "Enter"]) expect(listed).toContain(shown);
  });

  it("tem as teclas da linha de entrada", () => {
    for (const shown of ["Tab", "Shift+Tab", "Ctrl+Enter", "Esc"]) expect(listed).toContain(shown);
  });

  it("tem as teclas da selecao", () => {
    for (const shown of ["Espaço", "Shift+Espaço", "Ctrl+A"]) expect(listed).toContain(shown);
  });

  it("nao repete a mesma explicacao", () => {
    const texts = SHORTCUT_GROUPS.flatMap((group) => group.items.map((item) => item.text));
    expect(new Set(texts).size).toBe(texts.length);
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isEditableTarget,
  isSidebarShortcut,
  readSidebarHidden,
  saveSidebarHidden,
  SIDEBAR_STORAGE_KEY,
  useSidebar,
} from "./use-sidebar";

type Mods = Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>>;
const key = (name: string, mods: Mods = {}) => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("isSidebarShortcut", () => {
  it.each([
    ["Ctrl+B", key("b", { ctrlKey: true }), true],
    ["Cmd+B (Mac)", key("b", { metaKey: true }), true],
    ["B maiusculo (Caps Lock)", key("B", { ctrlKey: true }), true],
    ["B sozinho", key("b"), false],
    ["Ctrl+Shift+B", key("b", { ctrlKey: true, shiftKey: true }), false],
    ["Ctrl+Alt+B", key("b", { ctrlKey: true, altKey: true }), false],
    ["Ctrl+A", key("a", { ctrlKey: true }), false],
  ])("%s", (_name, event, expected) => expect(isSidebarShortcut(event)).toBe(expected));
});

describe("isEditableTarget", () => {
  it.each([["input"], ["textarea"], ["select"]])("%s e campo de digitar", (tag) => {
    expect(isEditableTarget(document.createElement(tag))).toBe(true);
  });

  it("elemento editavel", () => {
    const div = document.createElement("div");
    // O jsdom nao calcula isContentEditable sozinho
    Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isEditableTarget(div)).toBe(true);
  });

  it.each([["div"], ["button"], ["a"]])("%s nao e", (tag) => {
    expect(isEditableTarget(document.createElement(tag))).toBe(false);
  });

  it("sem alvo ou alvo que nao e elemento", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});

describe("guardar a escolha", () => {
  it("sem nada guardado, o menu aparece", () => expect(readSidebarHidden()).toBe(false));

  it("guarda e le oculto e aparente", () => {
    saveSidebarHidden(true);
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("1");
    expect(readSidebarHidden()).toBe(true);
    saveSidebarHidden(false);
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("0");
    expect(readSidebarHidden()).toBe(false);
  });

  it("valor estranho guardado conta como aparente", () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "talvez");
    expect(readSidebarHidden()).toBe(false);
  });

  it("sem armazenamento disponivel, le como aparente e guardar nao quebra", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(readSidebarHidden()).toBe(false);
    expect(() => saveSidebarHidden(true)).not.toThrow();
  });
});

describe("useSidebar", () => {
  function press(init: KeyboardEventInit, target: EventTarget = window) {
    const event = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it("comeca aparente e o toggle alterna e guarda", () => {
    const { result } = renderHook(() => useSidebar());
    expect(result.current.hidden).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.hidden).toBe(true);
    expect(readSidebarHidden()).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.hidden).toBe(false);
    expect(readSidebarHidden()).toBe(false);
  });

  it("abre oculto quando a ultima escolha foi ocultar", () => {
    saveSidebarHidden(true);
    expect(renderHook(() => useSidebar()).result.current.hidden).toBe(true);
  });

  it("Ctrl+B alterna e impede o atalho do navegador", () => {
    const { result } = renderHook(() => useSidebar());
    const event = press({ key: "b", ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.hidden).toBe(true);
  });

  it("dentro de um campo de texto o atalho nao toma a tecla", () => {
    const { result } = renderHook(() => useSidebar());
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = press({ key: "b", ctrlKey: true }, input);
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.hidden).toBe(false);
    input.remove();
  });

  it("outras teclas nao fazem nada", () => {
    const { result } = renderHook(() => useSidebar());
    press({ key: "b" });
    press({ key: "n", ctrlKey: true });
    press({ key: "b", ctrlKey: true, shiftKey: true });
    expect(result.current.hidden).toBe(false);
  });

  it("depois de desmontado o atalho nao responde mais", () => {
    const { unmount } = renderHook(() => useSidebar());
    unmount();
    const event = press({ key: "b", ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(readSidebarHidden()).toBe(false);
  });
});

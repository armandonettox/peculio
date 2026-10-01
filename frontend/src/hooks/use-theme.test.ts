import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockMatchMedia } from "@/test-utils/match-media";
import { THEME_STORAGE_KEY, useTheme } from "./use-theme";

const isDarkApplied = () => document.documentElement.classList.contains("dark");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useTheme", () => {
  it("segue o sistema escuro quando nao ha escolha salva", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(isDarkApplied()).toBe(true);
  });

  it("segue o sistema claro quando nao ha escolha salva", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe("light");
    expect(isDarkApplied()).toBe(false);
  });

  it("a escolha salva vence o sistema", () => {
    mockMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe("light");
    expect(isDarkApplied()).toBe(false);
  });

  it("escolha salva como escuro vale mesmo com sistema claro", () => {
    mockMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    renderHook(() => useTheme());
    expect(isDarkApplied()).toBe(true);
  });

  it("ignora valor invalido salvo e volta para o sistema", () => {
    mockMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, "roxo");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
  });

  it("alternar troca o tema, aplica a classe e salva a escolha", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());
    expect(result.current.resolvedTheme).toBe("dark");
    expect(isDarkApplied()).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    act(() => result.current.toggleTheme());
    expect(result.current.resolvedTheme).toBe("light");
    expect(isDarkApplied()).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("no modo sistema acompanha a troca do sistema com o app aberto", () => {
    const media = mockMatchMedia(false);
    renderHook(() => useTheme());
    expect(isDarkApplied()).toBe(false);

    act(() => media.setMatches(true));
    expect(isDarkApplied()).toBe(true);
  });

  it("com escolha explicita ignora a troca do sistema", () => {
    const media = mockMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderHook(() => useTheme());

    act(() => media.setMatches(true));
    expect(isDarkApplied()).toBe(false);
  });

  it("remove o ouvinte do sistema ao desmontar", () => {
    const media = mockMatchMedia(false);
    const { unmount } = renderHook(() => useTheme());
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it("nao quebra quando o localStorage lanca erro ao ler", () => {
    mockMatchMedia(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
    expect(isDarkApplied()).toBe(true);
  });

  it("troca o tema mesmo quando nao consegue salvar", () => {
    mockMatchMedia(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme());
    expect(isDarkApplied()).toBe(true);
  });

  it("funciona em navegador sem matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe("light");
  });
});

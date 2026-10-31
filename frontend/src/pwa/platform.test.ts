import { afterEach, describe, expect, it, vi } from "vitest";

import { detectPlatform, isStandalone, readInstallBannerDismissed, writeInstallBannerDismissed } from "./platform";

const nav = (userAgent: string, platform = "", maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints });

afterEach(() => vi.unstubAllGlobals());

describe("detectPlatform", () => {
  it("iPhone e iPad pelo user agent", () => {
    expect(detectPlatform(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari"))).toBe("ios");
    expect(detectPlatform(nav("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) Safari"))).toBe("ios");
  });

  it("iPad novo se apresenta como Mac, mas tem tela de toque", () => {
    expect(detectPlatform(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", "MacIntel", 5))).toBe("ios");
  });

  it("Mac de verdade (sem toque) nao e iOS", () => {
    expect(detectPlatform(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", "MacIntel", 0))).toBe("other");
  });

  it("Android", () => {
    expect(detectPlatform(nav("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile"))).toBe("android");
  });

  it("computador comum", () => {
    expect(detectPlatform(nav("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"))).toBe("other");
  });
});

describe("isStandalone", () => {
  it("navegador comum nao e standalone", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(isStandalone()).toBe(false);
  });

  it("display-mode standalone (Android, desktop instalado)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(display-mode: standalone)" }));
    expect(isStandalone()).toBe(true);
  });

  it("propriedade standalone do Safari do iPhone", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    // O jsdom nao tem a propriedade; ela so existe no Safari do iPhone
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    try {
      expect(isStandalone()).toBe(true);
    } finally {
      delete (navigator as Navigator & { standalone?: boolean }).standalone;
    }
  });
});

describe("aviso dispensado", () => {
  it("comeca nao dispensado e lembra depois de dispensar", () => {
    expect(readInstallBannerDismissed()).toBe(false);
    writeInstallBannerDismissed();
    expect(readInstallBannerDismissed()).toBe(true);
  });

  it("sem localStorage nao quebra", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(readInstallBannerDismissed()).toBe(false);
    expect(() => writeInstallBannerDismissed()).not.toThrow();
    vi.restoreAllMocks();
  });
});

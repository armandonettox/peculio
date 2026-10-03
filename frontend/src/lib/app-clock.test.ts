import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appNow, appToday, isAppClockSynced, resetAppClock, syncAppClock } from "./app-clock";

const SAO_PAULO = "America/Sao_Paulo";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  resetAppClock();
});

function at(iso: string) {
  vi.setSystemTime(new Date(iso));
}

describe("sem sincronizar", () => {
  it("usa o relogio do aparelho", () => {
    at("2026-03-12T15:00:00Z");
    expect(isAppClockSynced()).toBe(false);
    expect(appNow().toISOString()).toBe("2026-03-12T15:00:00.000Z");
    expect(appToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("o dia segue o fuso do app", () => {
  it.each([
    // Sao Paulo e UTC-3: a meia-noite de la e 03:00 UTC
    ["2026-03-12T02:59:59Z", SAO_PAULO, "2026-03-11"],
    ["2026-03-12T03:00:00Z", SAO_PAULO, "2026-03-12"],
    ["2026-03-12T23:59:59Z", SAO_PAULO, "2026-03-12"],
    // Toquio e UTC+9
    ["2026-03-12T14:59:59Z", "Asia/Tokyo", "2026-03-12"],
    ["2026-03-12T15:00:00Z", "Asia/Tokyo", "2026-03-13"],
    // Viradas de ano e ano bissexto
    ["2026-01-01T02:59:59Z", SAO_PAULO, "2025-12-31"],
    ["2028-03-01T02:59:59Z", SAO_PAULO, "2028-02-29"],
    ["2026-12-31T23:59:59Z", "Pacific/Auckland", "2027-01-01"],
    ["2026-06-15T01:30:00Z", "UTC", "2026-06-15"],
  ])("%s em %s e %s", (instant, timezone, expected) => {
    at(instant);
    syncAppClock({ now: instant, timezone });
    expect(appToday()).toBe(expected);
  });

  it("o mesmo instante e dias diferentes em dois fusos", () => {
    at("2026-06-15T01:30:00Z");
    syncAppClock({ now: "2026-06-15T01:30:00Z", timezone: SAO_PAULO });
    const saoPaulo = appToday();
    syncAppClock({ now: "2026-06-15T01:30:00Z", timezone: "Asia/Tokyo" });
    expect([saoPaulo, appToday()]).toEqual(["2026-06-14", "2026-06-15"]);
  });

  it("nao depende do fuso do aparelho", () => {
    const machineZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const days = ["Asia/Tokyo", "America/Los_Angeles", "UTC", "Pacific/Kiritimati"].map((deviceZone) => {
        process.env.TZ = deviceZone;
        at("2026-03-12T02:30:00Z");
        syncAppClock({ now: "2026-03-12T02:30:00Z", timezone: SAO_PAULO });
        return appToday();
      });
      expect(new Set(days)).toEqual(new Set(["2026-03-11"]));
    } finally {
      process.env.TZ = machineZone;
    }
  });
});

describe("relogio do aparelho errado", () => {
  it("corrige a diferenca: aparelho atrasado, o dia sai o do servidor", () => {
    // O aparelho acha que e 2020; o servidor sabe que e 2026-03-12 15:00 UTC
    at("2020-01-15T12:00:00Z");
    syncAppClock({ now: "2026-03-12T15:00:00Z", timezone: SAO_PAULO });
    expect(appToday()).toBe("2026-03-12");
    expect(appNow().toISOString()).toBe("2026-03-12T15:00:00.000Z");
  });

  it("corrige tambem aparelho adiantado", () => {
    at("2030-07-01T12:00:00Z");
    syncAppClock({ now: "2026-03-12T15:00:00Z", timezone: SAO_PAULO });
    expect(appToday()).toBe("2026-03-12");
  });

  it("o tempo continua andando depois de sincronizar: a virada do dia e percebida sem pedir nada", () => {
    at("2026-03-12T14:00:00Z");
    syncAppClock({ now: "2026-03-12T14:00:00Z", timezone: SAO_PAULO });
    expect(appToday()).toBe("2026-03-12");
    vi.setSystemTime(new Date("2026-03-13T02:59:59Z"));
    expect(appToday()).toBe("2026-03-12");
    vi.setSystemTime(new Date("2026-03-13T03:00:00Z"));
    expect(appToday()).toBe("2026-03-13");
  });

  it("a diferenca vale a partir do instante local informado (latencia da resposta)", () => {
    at("2026-03-12T15:00:05Z");
    // O servidor disse 15:00:00 e a resposta chegou 5 s depois no aparelho
    syncAppClock({ now: "2026-03-12T15:00:00Z", timezone: SAO_PAULO }, Date.parse("2026-03-12T15:00:05Z"));
    expect(appNow().toISOString()).toBe("2026-03-12T15:00:00.000Z");
  });
});

describe("dado invalido", () => {
  it("fuso desconhecido nao sincroniza e nao quebra", () => {
    at("2026-03-12T15:00:00Z");
    syncAppClock({ now: "2026-03-12T15:00:00Z", timezone: "Marte/Olympus" });
    expect(isAppClockSynced()).toBe(false);
  });

  it("data invalida nao sincroniza", () => {
    at("2026-03-12T15:00:00Z");
    syncAppClock({ now: "ontem", timezone: SAO_PAULO });
    expect(isAppClockSynced()).toBe(false);
  });

  it("um dado invalido nao desfaz uma sincronizacao boa", () => {
    at("2026-03-12T15:00:00Z");
    syncAppClock({ now: "2026-03-12T15:00:00Z", timezone: SAO_PAULO });
    syncAppClock({ now: "lixo", timezone: "Marte/Olympus" });
    expect(isAppClockSynced()).toBe(true);
    expect(appToday()).toBe("2026-03-12");
  });

  it("resetAppClock volta ao relogio do aparelho", () => {
    at("2020-01-15T12:00:00Z");
    syncAppClock({ now: "2026-03-12T15:00:00Z", timezone: SAO_PAULO });
    resetAppClock();
    expect(isAppClockSynced()).toBe(false);
    expect(appNow().toISOString()).toBe("2020-01-15T12:00:00.000Z");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppClock, syncAppClock } from "@/lib/app-clock";
import {
  DEFAULT_VALIDITY,
  SCOPE_OPTIONS,
  SOON_DAYS,
  VALIDITY_OPTIONS,
  expiresInDays,
  expiryOf,
  lastUsedText,
  needingAttention,
  prefixText,
  scopeLabel,
} from "./presentation";

const TODAY = "2026-03-15";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  resetAppClock();
});

describe("validade e permissao", () => {
  it("o padrao e 90 dias e esta entre as opcoes", () => {
    expect(DEFAULT_VALIDITY).toBe("90");
    expect(VALIDITY_OPTIONS.map((option) => option.value)).toEqual(["30", "90", "365", "never"]);
    expect(VALIDITY_OPTIONS.find((option) => option.value === DEFAULT_VALIDITY)?.label).toBe("90 dias (sugerido)");
  });

  it("converte a escolha em dias, e 'never' ou lixo em null", () => {
    expect(expiresInDays("30")).toBe(30);
    expect(expiresInDays("90")).toBe(90);
    expect(expiresInDays("365")).toBe(365);
    expect(expiresInDays("never")).toBeNull();
    expect(expiresInDays("")).toBeNull();
    expect(expiresInDays("abc")).toBeNull();
    expect(expiresInDays("0")).toBeNull();
    expect(expiresInDays("-5")).toBeNull();
    expect(expiresInDays("1.5")).toBeNull();
  });

  it("so leitura e a primeira opcao e a mais segura", () => {
    expect(SCOPE_OPTIONS.map((option) => option.value)).toEqual(["read", "write"]);
    expect(scopeLabel("read")).toBe("Só leitura");
    expect(scopeLabel("write")).toBe("Leitura e escrita");
  });
});

describe("expiryOf", () => {
  const at = (iso: string | null, expired = false) => expiryOf({ expires_at: iso, expired }, TODAY);

  it("sem data nunca expira", () => {
    expect(at(null)).toEqual({ state: "never", text: "Nunca expira" });
  });

  it("longe do fim so mostra a data", () => {
    expect(at("2026-06-13T15:00:00Z")).toEqual({ state: "ok", text: "Vence em 13/06/2026" });
    // 8 dias ainda nao e 'em breve'
    expect(at("2026-03-23T15:00:00Z").state).toBe("ok");
  });

  it("de 7 dias para baixo avisa e diz quando", () => {
    expect(SOON_DAYS).toBe(7);
    expect(at("2026-03-22T15:00:00Z")).toEqual({ state: "soon", text: "Vence em 22/03/2026 (em 7 dias)" });
    expect(at("2026-03-18T15:00:00Z").text).toBe("Vence em 18/03/2026 (em 3 dias)");
    expect(at("2026-03-16T15:00:00Z").text).toBe("Vence em 16/03/2026 (amanhã)");
    expect(at("2026-03-15T23:00:00Z").text).toBe("Vence em 15/03/2026 (hoje)");
  });

  it("o servidor diz quando venceu: mostra a data em que venceu", () => {
    expect(at("2026-03-10T12:00:00Z", true)).toEqual({ state: "expired", text: "Venceu em 10/03/2026" });
  });

  it("o dia segue o fuso do app, nao o UTC", () => {
    syncAppClock({ now: "2026-03-15T15:00:00Z", timezone: "America/Sao_Paulo" }, Date.now());
    // 02:00 UTC de 20/03 ainda e 19/03 em Sao Paulo (UTC-3)
    expect(at("2026-03-20T02:00:00Z").text).toBe("Vence em 19/03/2026 (em 4 dias)");
  });
});

describe("lastUsedText, prefixText e needingAttention", () => {
  it("nunca usado ou a data do ultimo uso", () => {
    expect(lastUsedText({ last_used_at: null })).toBe("Nunca usado");
    expect(lastUsedText({ last_used_at: "2026-03-12T18:30:00Z" })).toBe("Último uso: 12/03/2026");
  });

  it("o ultimo uso tambem segue o fuso do app", () => {
    syncAppClock({ now: "2026-03-15T15:00:00Z", timezone: "America/Sao_Paulo" }, Date.now());
    expect(lastUsedText({ last_used_at: "2026-03-12T01:00:00Z" })).toBe("Último uso: 11/03/2026");
  });

  it("o prefixo termina em reticencias: o resto nao existe mais", () => {
    expect(prefixText({ prefix: "fin_ab12cd34" })).toBe("fin_ab12cd34…");
  });

  it("conta so vencidos e perto de vencer", () => {
    const tokens = [
      { expires_at: null, expired: false },
      { expires_at: "2026-09-01T15:00:00Z", expired: false },
      { expires_at: "2026-03-17T15:00:00Z", expired: false },
      { expires_at: "2026-03-01T15:00:00Z", expired: true },
    ];
    expect(needingAttention(tokens, TODAY)).toBe(2);
    expect(needingAttention([], TODAY)).toBe(0);
    expect(needingAttention(tokens.slice(0, 2), TODAY)).toBe(0);
  });
});

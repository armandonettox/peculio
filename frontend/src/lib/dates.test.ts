import { describe, expect, it, vi } from "vitest";

import { syncAppClock } from "./app-clock";

import { daysBetween, firstOfMonth, formatDate, formatDateRange, formatDayHeading, formatMonthYear, shiftDay, shiftMonth, appToday } from "./dates";

describe("shiftDay", () => {
  it("soma e subtrai dias", () => {
    expect(shiftDay("2026-03-12", 1)).toBe("2026-03-13");
    expect(shiftDay("2026-03-12", -1)).toBe("2026-03-11");
  });

  it("atravessa mes e ano", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("respeita ano bissexto", () => {
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("formatDayHeading", () => {
  const today = "2026-03-12";

  it("chama de Hoje e Ontem", () => {
    expect(formatDayHeading("2026-03-12", today)).toBe("Hoje");
    expect(formatDayHeading("2026-03-11", today)).toBe("Ontem");
  });

  it("escreve as outras datas por extenso, com a primeira letra maiuscula", () => {
    expect(formatDayHeading("2026-03-10", today)).toBe("Terça-feira, 10 de março de 2026");
    expect(formatDayHeading("2025-12-25", today)).toBe("Quinta-feira, 25 de dezembro de 2025");
  });

  it("amanha nao e Hoje nem Ontem", () => {
    expect(formatDayHeading("2026-03-13", today)).toBe("Sexta-feira, 13 de março de 2026");
  });

  it("nao desloca o dia por causa do fuso (primeiro e ultimo dia do ano)", () => {
    expect(formatDayHeading("2026-01-01", "2026-06-01")).toBe("Quinta-feira, 1 de janeiro de 2026");
    expect(formatDayHeading("2026-12-31", "2026-06-01")).toBe("Quinta-feira, 31 de dezembro de 2026");
  });
});

it("appToday devolve a data no formato AAAA-MM-DD", () => {
  expect(appToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

describe("firstOfMonth", () => {
  it.each([
    ["2026-03-15", "2026-03-01"],
    ["2026-03-01", "2026-03-01"],
    ["2026-12-31", "2026-12-01"],
  ])("%s -> %s", (date, expected) => expect(firstOfMonth(date)).toBe(expected));
});

describe("shiftMonth", () => {
  it.each([
    ["2026-03-15", 1, "2026-04-01"],
    ["2026-03-15", -1, "2026-02-01"],
    ["2026-01-31", -1, "2025-12-01"],
    ["2026-12-10", 1, "2027-01-01"],
    ["2026-03-31", 0, "2026-03-01"],
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-03-10", -14, "2025-01-01"],
  ])("%s %i meses -> %s", (date, months, expected) => expect(shiftMonth(date, months)).toBe(expected));
});

describe("formatMonthYear", () => {
  it("escreve o mes por extenso com a primeira letra maiuscula", () => {
    expect(formatMonthYear("2026-03-15")).toBe("Março de 2026");
    expect(formatMonthYear("2026-12-01")).toBe("Dezembro de 2026");
  });
});

describe("formatDateRange", () => {
  it("mostra dia e mes quando o periodo fica no mesmo ano", () => {
    expect(formatDateRange("2026-03-09", "2026-03-15")).toBe("09/03 a 15/03");
    expect(formatDateRange("2026-01-01", "2026-12-31")).toBe("01/01 a 31/12");
  });

  it("mostra o ano nas duas pontas quando o periodo muda de ano", () => {
    expect(formatDateRange("2025-12-29", "2026-01-04")).toBe("29/12/2025 a 04/01/2026");
  });
});

describe("formatDate", () => {
  it("escreve dia, mes e ano com dois digitos", () => {
    expect(formatDate("2026-03-05")).toBe("05/03/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
  });
});

describe("daysBetween", () => {
  it.each([
    ["2026-03-10", "2026-03-10", 0],
    ["2026-03-10", "2026-03-15", 5],
    ["2026-03-15", "2026-03-10", -5],
    ["2026-02-28", "2026-03-01", 1],
    ["2028-02-28", "2028-03-01", 2],
    ["2026-12-31", "2027-01-01", 1],
    ["2026-03-28", "2026-03-30", 2],
  ])("de %s a %s: %i dias", (from, to, expected) => expect(daysBetween(from, to)).toBe(expected));
});

it("appToday de dates acompanha o relogio do app e nao o do aparelho", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2020-01-15T15:00:00Z"));
    syncAppClock({ now: "2026-03-12T15:00:00Z", timezone: "America/Sao_Paulo" });
    expect(appToday()).toBe("2026-03-12");
  } finally {
    vi.useRealTimers();
  }
});

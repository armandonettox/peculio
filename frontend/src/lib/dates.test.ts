import { describe, expect, it } from "vitest";

import { formatDayHeading, shiftDay, todayLocal } from "./dates";

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

it("todayLocal devolve a data no formato AAAA-MM-DD", () => {
  expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

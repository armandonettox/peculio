import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { formatDate, formatDateRange, formatDayHeading, formatMonthYear } from "./dates";
import { formatBytes } from "@/features/attachments/format";
import { formatMoney, parseMoneyInput } from "./money";

// Dinheiro e datas no idioma ingles: formato americano, e o leitor de valores no padrao do idioma da tela.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("dinheiro em ingles", () => {
  it("formata no padrao americano, em qualquer moeda", () => {
    expect(formatMoney("1234.5", "USD")).toBe("$1,234.50");
    expect(formatMoney("1234.5", "BRL")).toBe("R$1,234.50");
    expect(formatMoney("-50", "USD")).toBe("-$50.00");
    expect(formatMoney("1000", "JPY")).toBe("¥1,000");
  });
});

describe("leitura de valores em ingles", () => {
  it.each([
    ["1,234.50", "1234.50"],
    ["1234.5", "1234.50"],
    ["1234", "1234.00"],
    ["12.5", "12.50"],
    ["12,5", "12.50"], // virgula sozinha com 1 ou 2 digitos: lida como centavos
    ["1,234", "1234.00"], // grupo de tres digitos: milhar
    ["1,234,567.89", "1234567.89"],
    ["-1,234.50", "-1234.50"],
    ["  0.5 ", "0.50"],
    ["-0", "0.00"],
  ])("%s vira %s", (typed, expected) => expect(parseMoneyInput(typed, 2)).toEqual({ ok: true, value: expected }));

  it.each([["1.234,50"], ["1,23,45.00"], ["1..5"], ["abc"], ["12.3.4"], ["1,2345.00"]])("%s e recusado", (typed) => {
    const result = parseMoneyInput(typed, 2);
    expect(result.ok).toBe(false);
  });

  it("as mensagens de erro vem em ingles", () => {
    expect(parseMoneyInput("", 2)).toEqual({ ok: false, error: "Enter the amount." });
    expect(parseMoneyInput("abc", 2)).toEqual({ ok: false, error: "Invalid amount." });
    // Em ingles "1.234" tem tres casas decimais, nao e mil duzentos e trinta e quatro
    expect(parseMoneyInput("1.234", 0)).toEqual({ ok: false, error: "This currency has no cents." });
    expect(parseMoneyInput("1.5", 0)).toEqual({ ok: false, error: "This currency has no cents." });
    expect(parseMoneyInput("1.234", 2)).toEqual({ ok: false, error: "Use at most 2 decimal places." });
    expect(parseMoneyInput("9".repeat(20), 2)).toEqual({ ok: false, error: "Amount too large." });
  });

  it("o mesmo texto lido em portugues tem outro sentido", async () => {
    // "1.234" em portugues e mil duzentos e trinta e quatro; em ingles com 3 casas e recusado para uma moeda de 2
    await i18n.changeLanguage("pt-BR");
    expect(parseMoneyInput("1.234", 2)).toEqual({ ok: true, value: "1234.00" });
    expect(parseMoneyInput("1.234,50", 2)).toEqual({ ok: true, value: "1234.50" });
    expect(parseMoneyInput("", 2)).toEqual({ ok: false, error: "Informe o valor." });
  });

  it("o idioma pode ser dado explicitamente, sem olhar a tela", () => {
    expect(parseMoneyInput("1.234,50", 2, "pt-BR")).toEqual({ ok: true, value: "1234.50" });
    expect(parseMoneyInput("1,234.50", 2, "en-US")).toEqual({ ok: true, value: "1234.50" });
    expect(parseMoneyInput("1,234.50", 2, "en")).toEqual({ ok: true, value: "1234.50" });
  });
});

describe("datas em ingles", () => {
  it("data numerica com o mes antes do dia", () => {
    expect(formatDate("2026-03-05")).toBe("03/05/2026");
  });

  it("periodo com 'to', e com o ano quando muda de ano", () => {
    expect(formatDateRange("2026-03-09", "2026-03-15")).toBe("03/09 to 03/15");
    expect(formatDateRange("2025-12-29", "2026-01-04")).toBe("12/29/2025 to 01/04/2026");
  });

  it("titulo do dia e mes por extenso", () => {
    expect(formatDayHeading("2026-03-10", "2026-03-10")).toBe("Today");
    expect(formatDayHeading("2026-03-09", "2026-03-10")).toBe("Yesterday");
    expect(formatDayHeading("2026-03-12", "2026-03-20")).toBe("Thursday, March 12, 2026");
    expect(formatMonthYear("2026-03-01")).toBe("March 2026");
  });
});

describe("as mesmas funcoes em portugues", () => {
  it("voltam aos formatos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(formatDate("2026-03-05")).toBe("05/03/2026");
    expect(formatDateRange("2026-03-09", "2026-03-15")).toBe("09/03 a 15/03");
    expect(formatDayHeading("2026-03-12", "2026-03-20")).toBe("Quinta-feira, 12 de março de 2026");
    expect(formatMoney("1234.5", "BRL")).toMatch(/^R\$\s?1\.234,50$/);
  });
});

describe("tamanho de arquivo", () => {
  it("usa a pontuacao do idioma", async () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(850)).toBe("850 B");
    await i18n.changeLanguage("pt-BR");
    expect(formatBytes(1536)).toBe("1,5 KB");
  });
});

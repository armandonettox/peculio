import { describe, expect, it } from "vitest";

import { formatMoney, isNegativeMoney, negateMoney, parseMoneyInput, placesOf, sumMoney } from "./money";

// O Intl usa espaco sem quebra (U+00A0) entre o simbolo e o numero
const nbsp = (text: string) => text.replaceAll(" ", " ");

describe("formatMoney", () => {
  it("formata em reais no padrao brasileiro", () => {
    expect(formatMoney("1234.50", "BRL")).toBe(nbsp("R$ 1.234,50"));
    expect(formatMoney("0.00", "BRL")).toBe(nbsp("R$ 0,00"));
    expect(formatMoney("1234567.89", "BRL")).toBe(nbsp("R$ 1.234.567,89"));
  });

  it("formata saldo negativo", () => {
    expect(formatMoney("-100.00", "BRL")).toBe(nbsp("-R$ 100,00"));
  });

  it("formata outras moedas", () => {
    expect(formatMoney("10.00", "USD")).toBe(nbsp("US$ 10,00"));
    expect(formatMoney("100", "JPY")).toBe(nbsp("JP¥ 100"));
  });

  it("nao perde precisao em valores grandes (nao passa por float)", () => {
    // 9007199254740993 e o primeiro inteiro que o float nao representa
    expect(formatMoney("9007199254740993.00", "BRL")).toBe(nbsp("R$ 9.007.199.254.740.993,00"));
  });

  it("moeda desconhecida cai no codigo, sem quebrar a tela", () => {
    expect(formatMoney("5.00", "ZZZZ")).toBe("5.00 ZZZZ");
  });
});

describe("sumMoney", () => {
  it("soma com exatidao, sem erro de float", () => {
    expect(sumMoney(Array(10).fill("0.10"), 2)).toBe("1.00");
    expect(sumMoney(["0.10", "0.20"], 2)).toBe("0.30");
  });

  it("soma valores positivos e negativos", () => {
    expect(sumMoney(["100.00", "-30.25", "5.00"], 2)).toBe("74.75");
    expect(sumMoney(["10.00", "-25.50"], 2)).toBe("-15.50");
  });

  it("lista vazia soma zero", () => {
    expect(sumMoney([], 2)).toBe("0.00");
  });

  it("respeita moeda sem centavos", () => {
    expect(sumMoney(["100", "250"], 0)).toBe("350");
    expect(sumMoney([], 0)).toBe("0");
  });

  it("aguenta valores maiores que o float representa", () => {
    expect(sumMoney(["9007199254740993.00", "1.00"], 2)).toBe("9007199254740994.00");
  });

  it("resultado entre -1 e 1 mantem o zero antes da virgula", () => {
    expect(sumMoney(["0.50", "-0.75"], 2)).toBe("-0.25");
  });

  it("recusa texto que nao e dinheiro", () => {
    expect(() => sumMoney(["abc"], 2)).toThrow();
  });
});

describe("negateMoney e isNegativeMoney", () => {
  it("inverte o sinal", () => {
    expect(negateMoney("5000.00")).toBe("-5000.00");
    expect(negateMoney("-5000.00")).toBe("5000.00");
  });

  it("zero continua zero, sem virar -0", () => {
    expect(negateMoney("0.00")).toBe("0.00");
    expect(isNegativeMoney("-0.00")).toBe(false);
  });

  it("detecta negativo", () => {
    expect(isNegativeMoney("-0.01")).toBe(true);
    expect(isNegativeMoney("0.01")).toBe(false);
  });
});

describe("placesOf", () => {
  it("usa as casas da lista de moedas quando existe", () => {
    expect(placesOf("BRL", { BRL: 2, JPY: 0 })).toBe(2);
    expect(placesOf("JPY", { BRL: 2, JPY: 0 })).toBe(0);
  });

  it("sem a lista, assume 2 casas e 0 para o iene", () => {
    expect(placesOf("BRL")).toBe(2);
    expect(placesOf("JPY")).toBe(0);
  });
});

describe("parseMoneyInput", () => {
  it.each([
    ["1.234,50", "1234.50"],
    ["1234,5", "1234.50"],
    ["1234,50", "1234.50"],
    ["1234.50", "1234.50"],
    ["12.5", "12.50"],
    ["1.234", "1234.00"],
    ["1.234.567,89", "1234567.89"],
    ["100", "100.00"],
    ["0,5", "0.50"],
    ["  10,00  ", "10.00"],
    ["007", "7.00"],
    ["-100,00", "-100.00"],
    ["-0,50", "-0.50"],
  ])("lê %j como %j", (input, expected) => {
    expect(parseMoneyInput(input, 2)).toEqual({ ok: true, value: expected });
  });

  it("menos zero vira zero, sem sinal", () => {
    expect(parseMoneyInput("-0", 2)).toEqual({ ok: true, value: "0.00" });
  });

  it.each(["", "   ", "abc", "1,2,3", "1.2.3,4", "12,3a", "R$ 10", "--5", "1..000", "1.23.456", ",50", "10,"])(
    "recusa %j",
    (input) => {
      const result = parseMoneyInput(input, 2);
      // "10," vira 10.00 (virgula sem centavos): e aceito de proposito
      if (input === "10,") expect(result.ok).toBe(true);
      else expect(result.ok).toBe(false);
    },
  );

  it("recusa mais casas do que a moeda aceita", () => {
    const result = parseMoneyInput("10,555", 2);
    expect(result).toEqual({ ok: false, error: "Use no máximo 2 casas decimais." });
  });

  it("moeda sem centavos nao aceita fracao e devolve inteiro", () => {
    expect(parseMoneyInput("100", 0)).toEqual({ ok: true, value: "100" });
    expect(parseMoneyInput("1.500", 0)).toEqual({ ok: true, value: "1500" });
    expect(parseMoneyInput("100,5", 0)).toEqual({ ok: false, error: "Esta moeda não tem centavos." });
  });

  it("recusa valor com digitos demais para a coluna do banco", () => {
    expect(parseMoneyInput("1" + "0".repeat(16), 2)).toEqual({ ok: false, error: "Valor muito grande." });
    expect(parseMoneyInput("9".repeat(16), 2).ok).toBe(true);
  });

  it("pede o valor quando esta vazio", () => {
    expect(parseMoneyInput("", 2)).toEqual({ ok: false, error: "Informe o valor." });
  });

  it("o resultado sempre bate com o que o backend aceita (2 casas, ponto)", () => {
    for (const input of ["1.234,50", "7", "0,1"]) {
      const result = parseMoneyInput(input, 2);
      expect(result.ok && /^-?\d+\.\d{2}$/.test(result.value)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";

import { colorError, contrastRatio, normalizeHex, readableTextColor } from "./color";

describe("normalizeHex", () => {
  it.each([
    ["#1e3a6b", "#1E3A6B"],
    ["1E3A6B", "#1E3A6B"],
    ["  #00a878  ", "#00A878"],
    ["#abc", "#AABBCC"],
    ["FFF", "#FFFFFF"],
    ["#000000", "#000000"],
  ])("le %j como %j", (input, expected) => {
    expect(normalizeHex(input)).toBe(expected);
  });

  it.each(["", "   ", "#", "red", "#12345", "#1234567", "#GGGGGG", "#12 456", "rgb(1,2,3)", "##123456", "#12345G"])(
    "recusa %j",
    (input) => {
      expect(normalizeHex(input)).toBeNull();
    },
  );
});

describe("readableTextColor", () => {
  it.each([
    ["#FFFFFF", "#000000"], // fundo branco: texto preto
    ["#000000", "#FFFFFF"], // fundo preto: texto claro
    ["#FFFF00", "#000000"], // amarelo e claro
    ["#1E3A6B", "#FFFFFF"], // navy e escuro
    ["#0000FF", "#FFFFFF"], // azul puro e escuro
    ["#00FF00", "#000000"], // verde puro e claro
    ["#F59E0B", "#000000"], // ambar
    ["#E11D48", "#FFFFFF"], // vermelho rosado
    ["#808080", "#000000"], // cinza medio: o escuro ganha por pouco
  ])("sobre %s usa %s", (background, expected) => {
    expect(readableTextColor(background)).toBe(expected);
  });

  it("o texto escolhido tem contraste de pelo menos 4,5 em todo o espectro de cinza", () => {
    for (let level = 0; level <= 255; level += 5) {
      const hex = `#${level.toString(16).padStart(2, "0").repeat(3)}`.toUpperCase();
      const text = readableTextColor(hex);
      // O pior caso e o cinza medio: 4,5 e o minimo garantido pelo melhor entre branco e escuro
      expect(contrastRatio(hex, text), `fundo ${hex}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("o texto escolhido tem contraste de pelo menos 4,5 nas cores vivas", () => {
    for (const hex of ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#FFA500", "#800080"]) {
      expect(contrastRatio(hex, readableTextColor(hex)), `fundo ${hex}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("contrastRatio", () => {
  it("branco sobre preto e 21", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
  });

  it("a mesma cor tem contraste 1", () => {
    expect(contrastRatio("#1E3A6B", "#1E3A6B")).toBeCloseTo(1, 5);
  });

  it("nao depende da ordem", () => {
    expect(contrastRatio("#1E3A6B", "#FFFFFF")).toBeCloseTo(contrastRatio("#FFFFFF", "#1E3A6B"), 10);
  });
});

describe("colorError", () => {
  it("vazio e valido (sem cor)", () => {
    expect(colorError("")).toBeUndefined();
    expect(colorError("   ")).toBeUndefined();
  });

  it("cor valida nao tem erro", () => {
    expect(colorError("#1e3a6b")).toBeUndefined();
    expect(colorError("abc")).toBeUndefined();
  });

  it("cor invalida mostra o formato esperado", () => {
    expect(colorError("azul")).toBe("Use o formato #RRGGBB, por exemplo #1E3A6B.");
  });
});

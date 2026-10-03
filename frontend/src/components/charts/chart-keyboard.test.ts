import { describe, expect, it } from "vitest";

import { nextGridPoint, nextListIndex, firstGridPoint } from "./chart-keyboard";

const at = (seriesIndex: number, xIndex: number) => ({ seriesIndex, xIndex });

describe("nextListIndex", () => {
  it.each([
    // [total, atual, tecla, esperado]
    [5, 0, "ArrowRight", 1],
    [5, 2, "ArrowDown", 3],
    [5, 4, "ArrowRight", null],
    [5, 4, "ArrowDown", null],
    [5, 3, "ArrowLeft", 2],
    [5, 3, "ArrowUp", 2],
    [5, 0, "ArrowLeft", null],
    [5, 0, "ArrowUp", null],
    [5, 3, "Home", 0],
    [5, 0, "Home", null],
    [5, 1, "End", 4],
    [5, 4, "End", null],
    [1, 0, "ArrowRight", null],
    [1, 0, "End", null],
    [5, 2, "Tab", null],
    [5, 2, "a", null],
    [5, 2, "Enter", null],
    [0, 0, "ArrowRight", null],
  ])("%i itens, no %i, tecla %s -> %s", (count, current, key, expected) => {
    expect(nextListIndex(count, current, key)).toBe(expected);
  });
});

describe("nextGridPoint", () => {
  const full = [
    [true, true, true, true],
    [true, true, true, true],
  ];
  // A segunda serie so tem pontos em x=1 e x=3; a primeira tem buraco em x=2
  const gaps = [
    [true, true, false, true],
    [false, true, false, true],
  ];

  it.each([
    ["direita", full, at(0, 1), "ArrowRight", at(0, 2)],
    ["esquerda", full, at(0, 2), "ArrowLeft", at(0, 1)],
    ["direita no fim", full, at(0, 3), "ArrowRight", null],
    ["esquerda no comeco", full, at(0, 0), "ArrowLeft", null],
    ["baixo muda de serie no mesmo x", full, at(0, 2), "ArrowDown", at(1, 2)],
    ["cima volta para a serie de cima", full, at(1, 2), "ArrowUp", at(0, 2)],
    ["baixo na ultima serie", full, at(1, 2), "ArrowDown", null],
    ["cima na primeira serie", full, at(0, 2), "ArrowUp", null],
    ["Home vai ao primeiro ponto da serie", full, at(1, 2), "Home", at(1, 0)],
    ["End vai ao ultimo ponto da serie", full, at(0, 1), "End", at(0, 3)],
    ["Home no primeiro", full, at(0, 0), "Home", null],
    ["End no ultimo", full, at(0, 3), "End", null],
    // Buracos: a seta pula o x sem ponto
    ["direita pula o buraco", gaps, at(0, 1), "ArrowRight", at(0, 3)],
    ["esquerda pula o buraco", gaps, at(0, 3), "ArrowLeft", at(0, 1)],
    ["direita sem mais pontos depois do buraco", [[true, false, false]], at(0, 0), "ArrowRight", null],
    // Baixo em um x onde a serie de baixo nao tem ponto: nao inventa um ponto
    ["baixo sem ponto na outra serie", gaps, at(0, 0), "ArrowDown", null],
    ["baixo acha ponto na outra serie", gaps, at(0, 1), "ArrowDown", at(1, 1)],
    ["cima sem ponto na outra serie", gaps, at(1, 3), "ArrowUp", at(0, 3)],
    ["Home pula buraco no comeco", gaps, at(1, 3), "Home", at(1, 1)],
    ["End pula buraco no fim", [[true, true, false]], at(0, 0), "End", at(0, 1)],
    // Teclas que nao navegam
    ["Tab", full, at(0, 1), "Tab", null],
    ["Escape", full, at(0, 1), "Escape", null],
    ["letra", full, at(0, 1), "x", null],
    ["Enter", full, at(0, 1), "Enter", null],
  ])("%s", (_name, presence, current, key, expected) => {
    expect(nextGridPoint(presence, current, key)).toEqual(expected);
  });

  it("baixo salta uma serie sem ponto naquele x ate a proxima que tem", () => {
    const presence = [[true], [false], [true]];
    expect(nextGridPoint(presence, at(0, 0), "ArrowDown")).toEqual(at(2, 0));
    expect(nextGridPoint(presence, at(2, 0), "ArrowUp")).toEqual(at(0, 0));
  });

  it("um ponto so: nenhuma seta se mexe", () => {
    const one = [[true]];
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"]) {
      expect(nextGridPoint(one, at(0, 0), key)).toBeNull();
    }
  });
});

describe("firstGridPoint", () => {
  it("o primeiro ponto existente, serie a serie", () => {
    expect(firstGridPoint([[true, true]])).toEqual(at(0, 0));
    expect(firstGridPoint([[false, true], [true]])).toEqual(at(0, 1));
    expect(firstGridPoint([[false, false], [false, true]])).toEqual(at(1, 1));
  });

  it("sem nenhum ponto, null", () => {
    expect(firstGridPoint([])).toBeNull();
    expect(firstGridPoint([[false, false]])).toBeNull();
  });
});

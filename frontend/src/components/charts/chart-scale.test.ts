import { describe, expect, it } from "vitest";

import { linearScale, niceStep, niceTicks } from "./chart-scale";

describe("niceStep", () => {
  it.each([
    [0.9, 1],
    [1, 1],
    [1.1, 2],
    [2.1, 2.5],
    [2.6, 5],
    [5.1, 10],
    [0.03, 0.05],
    [130, 200],
    [4_000_000, 5_000_000],
    [0, 1],
    [-3, 1],
    [Number.NaN, 1],
  ])("passo bruto %s vira %s", (raw, expected) => {
    expect(niceStep(raw)).toBe(expected);
  });
});

describe("niceTicks", () => {
  // [min, max, marcas esperadas]
  it.each([
    [0, 100, [0, 25, 50, 75, 100]],
    [0, 1000, [0, 250, 500, 750, 1000]],
    [0, 10, [0, 2.5, 5, 7.5, 10]],
    [3, 97, [0, 25, 50, 75, 100]],
    [-50, 100, [-50, 0, 50, 100]],
    [-100, 100, [-100, -50, 0, 50, 100]],
    [10_000, 10_700, [10_000, 10_250, 10_500, 10_750]],
    [0, 1, [0, 0.25, 0.5, 0.75, 1]],
  ])("de %s a %s", (min, max, expected) => {
    expect(niceTicks(min as number, max as number).ticks).toEqual(expected);
  });

  it("tudo zero: de 0 a 1, o zero e a primeira marca", () => {
    const result = niceTicks(0, 0);
    expect(result.min).toBe(0);
    expect(result.max).toBe(1);
    expect(result.ticks[0]).toBe(0);
  });

  it("todos iguais e positivos: inclui o zero ate o valor", () => {
    const result = niceTicks(400, 400);
    expect(result.min).toBe(0);
    expect(result.max).toBeGreaterThanOrEqual(400);
  });

  it("todos iguais e negativos: vai do valor ate o zero", () => {
    const result = niceTicks(-400, -400);
    expect(result.min).toBeLessThanOrEqual(-400);
    expect(result.max).toBe(0);
  });

  it("so negativos: o zero entra no intervalo", () => {
    const result = niceTicks(-300, -100);
    expect(result.max).toBe(0);
    expect(result.ticks).toContain(0);
    expect(result.min).toBeLessThanOrEqual(-300);
  });

  it("so positivos longe do zero nao forca o zero", () => {
    const result = niceTicks(1000, 1100);
    expect(result.min).toBeGreaterThan(0);
  });

  it("entradas invertidas ou invalidas nao quebram", () => {
    expect(niceTicks(100, 0).ticks).toEqual([0, 25, 50, 75, 100]);
    const bad = niceTicks(Number.NaN, Number.POSITIVE_INFINITY);
    for (const tick of bad.ticks) expect(Number.isFinite(tick)).toBe(true);
  });

  it("valores muito grandes e muito pequenos", () => {
    const big = niceTicks(0, 3e30);
    expect(big.max).toBeGreaterThanOrEqual(3e30);
    expect(big.ticks.every((tick) => Number.isFinite(tick))).toBe(true);
    const tiny = niceTicks(0, 0.0003);
    expect(tiny.max).toBeGreaterThanOrEqual(0.0003);
    expect(tiny.max).toBeLessThan(0.001);
  });

  it("sem ruido de ponto flutuante nas marcas", () => {
    const result = niceTicks(0, 0.3);
    expect(result.ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("varredura em decimais: cobre o dado sem sobrar uma marca inteira", () => {
    for (let a = 0; a <= 30; a++) {
      for (const size of [1, 2, 3, 7, 11]) {
        for (const unit of [0.1, 0.01, 1]) {
          const low = Number((a * unit).toFixed(4));
          const high = Number(((a + size) * unit).toFixed(4));
          const result = niceTicks(low, high);
          const step = result.ticks[1] - result.ticks[0];
          const label = `${low}..${high}`;
          expect(result.min, label).toBeLessThanOrEqual(low + 1e-9);
          expect(result.max, label).toBeGreaterThanOrEqual(high - 1e-9);
          expect(low - result.min, label).toBeLessThan(step - 1e-9);
          expect(result.max - high, label).toBeLessThan(step - 1e-9);
        }
      }
    }
  });

  it("varredura: sempre de 3 a 5 marcas, ordenadas, cobrindo o intervalo", () => {
    const lows = [-1_000_000, -250, -3, -0.5, 0, 0.5, 7, 120, 99_999];
    const spans = [0, 0.01, 1, 3, 10, 77, 1000, 123_456];
    for (const low of lows) {
      for (const span of spans) {
        const high = low + span;
        const result = niceTicks(low, high);
        expect(result.ticks.length, `${low}..${high}`).toBeGreaterThanOrEqual(3);
        expect(result.ticks.length, `${low}..${high}`).toBeLessThanOrEqual(5);
        expect(result.min, `${low}..${high}`).toBeLessThanOrEqual(low);
        expect(result.max, `${low}..${high}`).toBeGreaterThanOrEqual(high);
        expect(result.ticks[0]).toBe(result.min);
        expect(result.ticks[result.ticks.length - 1]).toBe(result.max);
        for (let i = 1; i < result.ticks.length; i++) expect(result.ticks[i]).toBeGreaterThan(result.ticks[i - 1]);
      }
    }
  });
});

describe("linearScale", () => {
  it.each([
    [0, 0],
    [50, 100],
    [100, 200],
    [150, 300],
    [-50, -100],
  ])("dominio 0..100 na faixa 0..200: %s vira %s", (value, expected) => {
    expect(linearScale(0, 100, 0, 200)(value)).toBe(expected);
  });

  it("faixa invertida (eixo Y do SVG)", () => {
    const y = linearScale(0, 100, 180, 20);
    expect(y(0)).toBe(180);
    expect(y(100)).toBe(20);
    expect(y(50)).toBe(100);
  });

  it("dominio sem largura cai no meio da faixa", () => {
    expect(linearScale(5, 5, 0, 100)(5)).toBe(50);
  });

  it("valor invalido cai no meio da faixa", () => {
    expect(linearScale(0, 10, 0, 100)(Number.NaN)).toBe(50);
  });
});

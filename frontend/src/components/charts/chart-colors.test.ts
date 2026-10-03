import { describe, expect, it } from "vitest";

import { CHART_COLOR_NAMES, chartColorVar, pickColor } from "./chart-colors";

describe("chartColorVar", () => {
  it.each(CHART_COLOR_NAMES.map((name) => [name, `var(--chart-${name})`]))("%s aponta para o token %s", (name, expected) => {
    expect(chartColorVar(name as (typeof CHART_COLOR_NAMES)[number])).toBe(expected);
  });

  it("nunca devolve um hex solto", () => {
    for (const name of CHART_COLOR_NAMES) expect(chartColorVar(name)).not.toMatch(/#/);
  });
});

describe("pickColor", () => {
  it("respeita a cor informada", () => {
    expect(pickColor("negative", 0)).toBe("negative");
  });

  it.each([
    [0, "primary"],
    [1, "accent"],
    [5, "positive"],
    [6, "primary"],
    [13, "accent"],
  ])("sem cor, a posicao %s usa %s", (index, expected) => {
    expect(pickColor(undefined, index)).toBe(expected);
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])("posicao invalida %s cai na primeira cor", (index) => {
    expect(pickColor(undefined, index)).toBe("primary");
  });
});

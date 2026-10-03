import { describe, expect, it } from "vitest";

import {
  areaPath,
  buildXValues,
  dashPattern,
  estimateTextWidth,
  linePath,
  markerPath,
  markerShape,
  splitSegments,
  sparklinePoints,
  thinLabelIndexes,
  tooltipPlacement,
} from "./line-geometry";

describe("buildXValues", () => {
  it("une os x das series, sem repetir e em ordem", () => {
    const result = buildXValues([
      { points: [{ x: "2026-03" }, { x: "2026-01" }] },
      { points: [{ x: "2026-02" }, { x: "2026-03" }] },
    ]);
    expect(result).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("dias ordenam como texto", () => {
    expect(buildXValues([{ points: [{ x: "2026-03-15" }, { x: "2026-03-02" }, { x: "2026-02-28" }] }])).toEqual([
      "2026-02-28",
      "2026-03-02",
      "2026-03-15",
    ]);
  });

  it("sem series ou sem pontos devolve vazio", () => {
    expect(buildXValues([])).toEqual([]);
    expect(buildXValues([{ points: [] }])).toEqual([]);
  });
});

describe("splitSegments", () => {
  it("null separa trechos", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 1 };
    const c = { x: 3, y: 3 };
    expect(splitSegments([a, b, null, c])).toEqual([[a, b], [c]]);
  });

  it("coordenada invalida conta como ausente", () => {
    const a = { x: 0, y: 0 };
    expect(splitSegments([a, { x: Number.NaN, y: 1 }, a])).toEqual([[a], [a]]);
  });

  it("y invalido tambem conta como ausente", () => {
    const a = { x: 0, y: 0 };
    expect(splitSegments([a, { x: 1, y: Number.POSITIVE_INFINITY }, a])).toEqual([[a], [a]]);
  });

  it("sem pontos devolve vazio", () => {
    expect(splitSegments([])).toEqual([]);
    expect(splitSegments([null, null])).toEqual([]);
  });
});

describe("linePath", () => {
  it.each([
    [[{ x: 0, y: 10 }, { x: 5, y: 20 }, { x: 10, y: 5 }], "M0 10 L5 20 L10 5"],
    [[{ x: 0.123, y: 10.456 }, { x: 1, y: 2 }], "M0.12 10.46 L1 2"],
    [[{ x: 0, y: 0 }, null, { x: 5, y: 5 }, { x: 6, y: 6 }], "M5 5 L6 6"],
    [[{ x: 0, y: 0 }], ""],
    [[], ""],
  ])("caminho de %j", (points, expected) => {
    expect(linePath(points as never)).toBe(expected);
  });

  it("dois trechos viram dois M", () => {
    const path = linePath([{ x: 0, y: 0 }, { x: 1, y: 1 }, null, { x: 3, y: 3 }, { x: 4, y: 4 }]);
    expect(path).toBe("M0 0 L1 1 M3 3 L4 4");
  });
});

describe("areaPath", () => {
  it("fecha ate a linha de base", () => {
    expect(areaPath([{ x: 0, y: 10 }, { x: 10, y: 20 }], 100)).toBe("M0 100 L0 10 L10 20 L10 100 Z");
  });

  it("um ponto so nao desenha area", () => {
    expect(areaPath([{ x: 0, y: 10 }], 100)).toBe("");
  });

  it("trecho interrompido gera uma area por trecho", () => {
    const path = areaPath([{ x: 0, y: 1 }, { x: 1, y: 1 }, null, { x: 3, y: 2 }, { x: 4, y: 2 }], 50);
    expect(path.match(/Z/g)).toHaveLength(2);
  });
});

describe("estimateTextWidth", () => {
  it("cresce com o texto e com a fonte", () => {
    expect(estimateTextWidth("mar/26", 11)).toBe(Math.ceil(6 * 11 * 0.58));
    expect(estimateTextWidth("R$ 1.234,50", 11)).toBeGreaterThan(estimateTextWidth("R$ 1", 11));
    expect(estimateTextWidth("", 11)).toBe(0);
  });
});

describe("thinLabelIndexes", () => {
  // [larguras, pitch, gap, indices esperados]
  it.each([
    [[], 20, 8, []],
    [[30], 20, 8, [0]],
    [[30, 30, 30], 100, 8, [0, 1, 2]],
    [[30, 30, 30, 30], 19, 8, [1, 3]],
    [[30, 30, 30, 30, 30], 19, 8, [0, 2, 4]],
    [[30, 30, 30, 30, 30, 30, 30], 10, 8, [2, 6]],
    [[30, 30, 30], 0, 8, [2]],
    [[30, 30, 30], -5, 8, [2]],
    [[20, 40, 20, 20], 48, 8, [0, 1, 2, 3]],
    [[20, 41, 20, 20], 48, 8, [1, 3]],
  ])("larguras %j pitch %s gap %s", (widths, pitch, gap, expected) => {
    expect(thinLabelIndexes(widths as number[], pitch as number, gap as number)).toEqual(expected);
  });

  it("36 pontos em 390 px: o ultimo sempre aparece e nenhum rotulo encosta no vizinho", () => {
    const widths = Array.from({ length: 36 }, () => 36);
    const pitch = (390 - 80) / 35;
    const shown = thinLabelIndexes(widths, pitch);
    expect(shown[shown.length - 1]).toBe(35);
    expect(shown.length).toBeLessThan(36);
    for (let i = 1; i < shown.length; i++) {
      expect((shown[i] - shown[i - 1]) * pitch).toBeGreaterThanOrEqual(36 + 8);
    }
  });

  it("gap padrao e 8", () => {
    expect(thinLabelIndexes([30, 30, 30], 30)).toEqual([0, 2]);
  });
});

describe("markerShape e dashPattern", () => {
  it.each([
    [0, "circle"],
    [1, "square"],
    [2, "diamond"],
    [3, "triangle"],
    [4, "circle"],
    [-1, "circle"],
    [Number.NaN, "circle"],
  ])("serie %s usa %s", (index, expected) => {
    expect(markerShape(index)).toBe(expected);
  });

  it.each([
    [0, ""],
    [1, "6 4"],
    [2, "2 3"],
    [3, "10 3 2 3"],
    [4, ""],
  ])("serie %s tem o tracejado %j", (index, expected) => {
    expect(dashPattern(index)).toBe(expected);
  });
});

describe("markerPath", () => {
  it.each(["circle", "square", "diamond", "triangle"] as const)("%s gera caminho fechado e finito", (shape) => {
    const path = markerPath(shape, 50, 40, 4);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path).not.toMatch(/NaN|Infinity/);
  });

  it("quadrado ocupa de cx-r a cx+r", () => {
    expect(markerPath("square", 10, 10, 3)).toBe("M7 7 H13 V13 H7 Z");
  });

  it("circulo, losango e triangulo tem caminho exato", () => {
    expect(markerPath("circle", 10, 10, 3)).toBe("M7 10 A3 3 0 1 0 13 10 A3 3 0 1 0 7 10 Z");
    expect(markerPath("diamond", 10, 10, 2)).toBe("M10 7.4 L12.6 10 L10 12.6 L7.4 10 Z");
    expect(markerPath("triangle", 10, 10, 2)).toBe("M10 7.6 L12.4 12 L7.6 12 Z");
  });

  it("formas diferentes geram caminhos diferentes", () => {
    const paths = (["circle", "square", "diamond", "triangle"] as const).map((shape) => markerPath(shape, 10, 10, 3));
    expect(new Set(paths).size).toBe(4);
  });

  it("coordenada invalida vira 0, sem NaN", () => {
    expect(markerPath("circle", Number.NaN, Number.NaN, 3)).not.toMatch(/NaN/);
  });
});

describe("tooltipPlacement", () => {
  it.each([
    [10, 100, 400, { horizontal: "start", vertical: "above" }],
    [79, 100, 400, { horizontal: "start", vertical: "above" }],
    [80, 100, 400, { horizontal: "center", vertical: "above" }],
    [200, 100, 400, { horizontal: "center", vertical: "above" }],
    [320, 100, 400, { horizontal: "center", vertical: "above" }],
    [321, 100, 400, { horizontal: "end", vertical: "above" }],
    [390, 100, 400, { horizontal: "end", vertical: "above" }],
    [200, 47, 400, { horizontal: "center", vertical: "below" }],
    [200, 48, 400, { horizontal: "center", vertical: "above" }],
  ])("x %s y %s largura %s", (x, y, width, expected) => {
    expect(tooltipPlacement(x, y, width)).toEqual(expected);
  });
});

describe("sparklinePoints", () => {
  it("vazio devolve vazio", () => {
    expect(sparklinePoints([], 100, 20, 2)).toEqual([]);
  });

  it("um ponto fica no centro", () => {
    expect(sparklinePoints([7], 100, 20, 2)).toEqual([{ x: 50, y: 10 }]);
  });

  it("todos iguais: linha reta no meio", () => {
    const points = sparklinePoints([5, 5, 5], 100, 20, 2);
    expect(points.map((p) => p.y)).toEqual([10, 10, 10]);
  });

  it("o maior fica no topo e o menor embaixo, respeitando a margem", () => {
    const points = sparklinePoints([0, 10, 5], 100, 20, 2);
    expect(points[0]).toEqual({ x: 2, y: 18 });
    expect(points[1]).toEqual({ x: 50, y: 2 });
    expect(points[2]).toEqual({ x: 98, y: 10 });
  });

  it("negativos funcionam", () => {
    const points = sparklinePoints([-10, 0], 100, 20, 0);
    expect(points[0].y).toBe(20);
    expect(points[1].y).toBe(0);
  });

  it("ignora valores nao finitos", () => {
    expect(sparklinePoints([Number.NaN, 1, 2], 100, 20, 0)).toHaveLength(2);
  });
});

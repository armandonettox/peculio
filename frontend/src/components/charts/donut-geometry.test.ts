import { describe, expect, it } from "vitest";

import { arcMidpoint, groupSlices, OTHER_KEY, ringSlicePath, roundedPercents, sliceAngles } from "./donut-geometry";

const slice = (key: string, value: string) => ({ key, label: key.toUpperCase(), value });

describe("groupSlices", () => {
  it("ordena da maior para a menor", () => {
    const result = groupSlices([slice("a", "10"), slice("b", "30"), slice("c", "20")], 6, "Outras");
    expect(result.map((item) => item.key)).toEqual(["b", "c", "a"]);
  });

  it("ignora zero, negativo e texto invalido", () => {
    const result = groupSlices([slice("a", "10"), slice("z", "0.00"), slice("n", "-5"), slice("x", "abc"), slice("e", "")], 6, "Outras");
    expect(result.map((item) => item.key)).toEqual(["a"]);
  });

  it("vazio ou so valores ignorados devolve vazio", () => {
    expect(groupSlices([], 6, "Outras")).toEqual([]);
    expect(groupSlices([slice("z", "0")], 6, "Outras")).toEqual([]);
  });

  it("no limite exato nao agrupa", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((key, i) => slice(key, String(60 - i)));
    const result = groupSlices(six, 6, "Outras");
    expect(result).toHaveLength(6);
    expect(result.some((item) => item.isOther)).toBe(false);
  });

  it("acima do limite, as menores viram Outras e o total de fatias e o limite", () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"].map((key, i) => slice(key, String(70 - i * 10)));
    const result = groupSlices(seven, 6, "Demais");
    expect(result).toHaveLength(6);
    const other = result[5];
    expect(other).toMatchObject({ key: OTHER_KEY, label: "Demais", isOther: true, color: "muted" });
    // Valores 70, 60, 50, 40, 30, 20, 10: as duas menores (20 e 10) viram Outras
    expect(other.value).toBe("30");
    expect(result.slice(0, 5).map((item) => item.key)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("a soma de Outras e exata em decimais", () => {
    const items = [slice("a", "100.00"), slice("b", "0.10"), slice("c", "0.20")];
    const result = groupSlices(items, 2, "Outras");
    expect(result).toHaveLength(2);
    expect(result[1].value).toBe("0.30");
    expect(result[1].amount).toBeCloseTo(0.3, 10);
  });

  it("maxSlices menor que 2 vale 2", () => {
    const items = [slice("a", "5"), slice("b", "4"), slice("c", "3")];
    expect(groupSlices(items, 0, "Outras")).toHaveLength(2);
    expect(groupSlices(items, -3, "Outras")).toHaveLength(2);
    expect(groupSlices(items, 1, "Outras")).toHaveLength(2);
  });

  it("maxSlices invalido volta ao padrao 6", () => {
    const items = Array.from({ length: 8 }, (_, i) => slice(`k${i}`, String(10 + i)));
    expect(groupSlices(items, Number.NaN, "Outras")).toHaveLength(6);
  });

  it("maxSlices fracionario e arredondado para baixo", () => {
    const items = Array.from({ length: 5 }, (_, i) => slice(`k${i}`, String(10 + i)));
    expect(groupSlices(items, 3.9, "Outras")).toHaveLength(3);
  });

  it("empate de valores mantem a ordem original", () => {
    const result = groupSlices([slice("a", "5"), slice("b", "5"), slice("c", "5")], 6, "Outras");
    expect(result.map((item) => item.key)).toEqual(["a", "b", "c"]);
  });

  it("mantem a cor informada", () => {
    const result = groupSlices([{ ...slice("a", "5"), color: "negative" as const }], 6, "Outras");
    expect(result[0].color).toBe("negative");
  });
});

describe("roundedPercents", () => {
  // [valores, percentuais esperados]
  it.each([
    [[50, 50], [50, 50]],
    [[1, 1, 1], [34, 33, 33]],
    [[1, 1, 1, 1, 1, 1], [17, 17, 17, 17, 16, 16]],
    [[100], [100]],
    [[200, 100], [67, 33]],
    [[0.001, 99.999], [0, 100]],
    [[3, 3, 3, 1], [30, 30, 30, 10]],
    [[], []],
    [[0, 0], [0, 0]],
    [[0.5, 0.5], [50, 50]],
    [[0.25, 0.75], [25, 75]],
  ])("%j vira %j", (amounts, expected) => {
    expect(roundedPercents(amounts as number[])).toEqual(expected);
  });

  it("a soma e sempre 100 em varias combinacoes", () => {
    for (let n = 1; n <= 8; n++) {
      for (let seed = 1; seed <= 20; seed++) {
        const amounts = Array.from({ length: n }, (_, i) => ((seed * 7919 + i * 104729) % 977) + 1);
        const sum = roundedPercents(amounts).reduce((a, b) => a + b, 0);
        expect(sum, `${amounts}`).toBe(100);
      }
    }
  });

  it("valores negativos nao entram na conta", () => {
    expect(roundedPercents([10, -5, 10])).toEqual([50, 0, 50]);
  });
});

describe("sliceAngles", () => {
  it("comeca no topo e vai no sentido horario", () => {
    const [first, second] = sliceAngles([1, 1]);
    expect(first.start).toBeCloseTo(-Math.PI / 2, 10);
    expect(first.end).toBeCloseTo(Math.PI / 2, 10);
    expect(second.start).toBeCloseTo(first.end, 10);
    expect(second.end).toBeCloseTo((3 * Math.PI) / 2, 10);
  });

  it("os arcos somam 360 graus e sao proporcionais", () => {
    const arcs = sliceAngles([1, 2, 3, 4]);
    const sweeps = arcs.map((arc) => arc.end - arc.start);
    expect(sweeps.reduce((a, b) => a + b, 0)).toBeCloseTo(Math.PI * 2, 10);
    expect(sweeps[3] / sweeps[0]).toBeCloseTo(4, 10);
  });

  it("valor negativo no meio nao tira arco das outras fatias", () => {
    const arcs = sliceAngles([10, -5, 10]);
    expect(arcs[1].end - arcs[1].start).toBe(0);
    expect(arcs[0].end - arcs[0].start).toBeCloseTo(Math.PI, 10);
    expect(arcs[2].end - arcs[2].start).toBeCloseTo(Math.PI, 10);
  });

  it("zero e negativo ficam sem arco; total zero nao gera NaN", () => {
    expect(sliceAngles([0, -3])).toEqual([
      { start: -Math.PI / 2, end: -Math.PI / 2 },
      { start: -Math.PI / 2, end: -Math.PI / 2 },
    ]);
    expect(sliceAngles([])).toEqual([]);
  });
});

describe("ringSlicePath", () => {
  it("quarto de volta: arco pequeno, sentido horario na borda externa", () => {
    const path = ringSlicePath(100, 100, 80, 50, -Math.PI / 2, 0);
    expect(path).toBe("M100 20 A80 80 0 0 1 180 100 L150 100 A50 50 0 0 0 100 50 Z");
  });

  it("mais de meia volta usa o arco grande", () => {
    const path = ringSlicePath(100, 100, 80, 50, -Math.PI / 2, Math.PI * 0.75);
    expect(path).toContain("A80 80 0 1 1");
    expect(path).toContain("A50 50 0 1 0");
  });

  it("meia volta exata ainda e arco pequeno", () => {
    expect(ringSlicePath(100, 100, 80, 50, -Math.PI / 2, Math.PI / 2)).toContain("A80 80 0 0 1");
  });

  it("360 graus vira anel com dois semicirculos por contorno", () => {
    const path = ringSlicePath(100, 100, 80, 50, -Math.PI / 2, (3 * Math.PI) / 2);
    expect(path).toBe(
      "M180 100 A80 80 0 1 1 20 100 A80 80 0 1 1 180 100 Z M150 100 A50 50 0 1 0 50 100 A50 50 0 1 0 150 100 Z",
    );
  });

  it("quase 360 graus (arredondamento de ponto flutuante) tambem e tratado como volta inteira", () => {
    const path = ringSlicePath(100, 100, 80, 50, -Math.PI / 2, (3 * Math.PI) / 2 - 1e-12);
    expect(path.match(/Z/g)).toHaveLength(2);
  });

  it("sem arco devolve caminho vazio", () => {
    expect(ringSlicePath(100, 100, 80, 50, 1, 1)).toBe("");
    expect(ringSlicePath(100, 100, 80, 50, 2, 1)).toBe("");
    expect(ringSlicePath(100, 100, 80, 50, Number.NaN, 1)).toBe("");
  });

  it("nunca tem NaN ou Infinity", () => {
    for (const end of [0.001, 1, 3, 3.5, 6, 6.28]) {
      expect(ringSlicePath(100, 100, 80, 50, 0, end)).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe("arcMidpoint", () => {
  it("fatia que vai do topo ate a direita tem o meio a 45 graus", () => {
    const mid = arcMidpoint(100, 100, 100, { start: -Math.PI / 2, end: 0 });
    expect(mid.x).toBeCloseTo(170.71, 2);
    expect(mid.y).toBeCloseTo(29.29, 2);
  });
});

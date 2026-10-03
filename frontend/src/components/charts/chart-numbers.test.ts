import { describe, expect, it } from "vitest";

import { parseDecimal, round2, sumDecimals, toDecimalText } from "./chart-numbers";

describe("parseDecimal", () => {
  it.each([
    ["1234.50", 1234.5],
    ["-10.25", -10.25],
    ["0", 0],
    ["99999999999999999999.99", 1e20],
    ["abc", 0],
    ["", 0],
    ["NaN", 0],
    ["Infinity", 0],
    ["1e999", 0],
  ])("%s vira %s", (text, expected) => {
    expect(parseDecimal(text)).toBe(expected);
  });
});

describe("toDecimalText", () => {
  it.each([
    [1234.5, "1234.5"],
    [-7, "-7"],
    [0, "0"],
    [-0, "0"],
    [1e21, "1000000000000000000000"],
    [0.0000001, "0.0000001"],
    [Number.NaN, "0"],
    [Number.POSITIVE_INFINITY, "0"],
  ])("%s vira %s", (value, expected) => {
    expect(toDecimalText(value)).toBe(expected);
  });

  it("nunca usa notacao cientifica", () => {
    expect(toDecimalText(1e30)).not.toMatch(/e/i);
  });
});

describe("sumDecimals", () => {
  it.each([
    [[], "0"],
    [["10.50", "0.25"], "10.75"],
    [["0.1", "0.2"], "0.3"],
    [["100", "50"], "150"],
    [["1.5", "2"], "3.5"],
    [["10.00", "-10.00"], "0.00"],
    [["5.00", "-7.25"], "-2.25"],
    [["-0.50", "0.25"], "-0.25"],
    [["99999999999999999999.99", "0.01"], "100000000000000000000.00"],
    [["abc", "2.50"], "2.50"],
    [["+3.10", "0.90"], "4.00"],
  ])("soma %j e da %s", (values, expected) => {
    expect(sumDecimals(values as string[])).toBe(expected);
  });
});

describe("round2", () => {
  it.each([
    [1.005, 1],
    [1.239, 1.24],
    [-2.5, -2.5],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])("%s vira %s", (value, expected) => {
    expect(round2(value)).toBe(expected);
  });
});

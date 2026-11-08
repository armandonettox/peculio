import { expect, it } from "vitest";

import { monthRange, monthsEndingAt, shiftMonthRange, withYear, yearOf } from "./month";

it("o mes vai do primeiro ao ultimo dia, em qualquer data dele", () => {
  expect(monthRange("2026-03-15")).toEqual({ month: "2026-03-01", from: "2026-03-01", to: "2026-03-31" });
  expect(monthRange("2026-04-30").to).toBe("2026-04-30");
});

it("fevereiro respeita o ano bissexto", () => {
  expect(monthRange("2024-02-10").to).toBe("2024-02-29");
  expect(monthRange("2026-02-10").to).toBe("2026-02-28");
});

it("andar de mes cruza a virada do ano nos dois sentidos", () => {
  expect(shiftMonthRange(monthRange("2026-01-20"), -1).month).toBe("2025-12-01");
  expect(shiftMonthRange(monthRange("2026-12-05"), 1).month).toBe("2027-01-01");
});

it("os ultimos N meses terminam no ultimo dia do mes escolhido", () => {
  expect(monthsEndingAt(monthRange("2026-03-15"), 6)).toEqual({ from: "2025-10-01", to: "2026-03-31" });
  expect(monthsEndingAt(monthRange("2026-03-15"), 1)).toEqual({ from: "2026-03-01", to: "2026-03-31" });
});

it("ano de um mes e trocar o ano mantendo o mes", () => {
  expect(yearOf("2026-11-01")).toBe(2026);
  expect(withYear("2026-11-01", 2024)).toBe("2024-11-01");
});

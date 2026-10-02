import { describe, expect, it } from "vitest";

import {
  countActiveFilters,
  dateRangeError,
  readState,
  toReportFilters,
  writeState,
} from "./period";

const params = (text: string) => new URLSearchParams(text);

describe("readState", () => {
  it("sem nada na URL e este mes", () => {
    expect(readState(params(""))).toEqual({ period: "this-month" });
  });

  it("le periodo, datas e filtros", () => {
    expect(readState(params("periodo=personalizado&de=2026-01-01&ate=2026-02-01&conta=a&categoria=c&tag=t&orcamento=o"))).toEqual({
      period: "custom",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      accountId: "a",
      categoryId: "c",
      tagId: "t",
      budgetId: "o",
    });
  });

  it("periodo desconhecido na URL cai em este mes", () => {
    expect(readState(params("periodo=semana")).period).toBe("this-month");
  });
});

describe("writeState", () => {
  it("este mes nao fica na URL", () => {
    expect(writeState(params("periodo=ano"), { period: "this-month" }).toString()).toBe("");
  });

  it("mudar para um periodo pronto apaga as datas soltas e mantem os filtros", () => {
    const next = writeState(params("periodo=personalizado&de=2026-01-01&ate=2026-02-01&conta=a"), { period: "this-year" });
    expect(next.toString()).toBe("periodo=ano&conta=a");
  });

  it("valor vazio remove o filtro", () => {
    expect(writeState(params("conta=a&tag=t"), { accountId: "" }).toString()).toBe("tag=t");
  });

  it("nao mexe no que o patch nao cita", () => {
    expect(writeState(params("conta=a"), { tagId: "t" }).toString()).toBe("conta=a&tag=t");
  });
});

describe("toReportFilters", () => {
  it.each(["this-month", "last-month", "this-year"] as const)("%s vai como period, sem datas", (period) => {
    expect(toReportFilters({ period })).toEqual({ period });
  });

  it("periodo pronto ignora datas soltas que sobraram no estado", () => {
    expect(toReportFilters({ period: "this-year", dateFrom: "2026-01-02", dateTo: "2026-02-03" })).toEqual({
      period: "this-year",
    });
  });

  it("personalizado manda so as datas digitadas, mesmo incompletas, e nunca period", () => {
    expect(toReportFilters({ period: "custom", dateFrom: "2026-01-02" })).toStrictEqual({ dateFrom: "2026-01-02" });
    expect(toReportFilters({ period: "custom", dateTo: "2026-02-03" })).toStrictEqual({ dateTo: "2026-02-03" });
    expect(toReportFilters({ period: "custom", dateFrom: "2026-01-02", dateTo: "2026-02-03" })).toEqual({
      dateFrom: "2026-01-02",
      dateTo: "2026-02-03",
    });
    expect(toReportFilters({ period: "custom" })).toStrictEqual({});
  });

  it("junta o periodo e os filtros e ignora campos vazios", () => {
    expect(toReportFilters({ period: "this-year", accountId: "a", tagId: "t", categoryId: "", budgetId: "o" })).toEqual({
      period: "this-year",
      accountId: "a",
      tagId: "t",
      budgetId: "o",
    });
  });
});

it("countActiveFilters conta so conta, categoria, tag e orcamento", () => {
  expect(countActiveFilters({ period: "custom", dateFrom: "2026-01-01", accountId: "a", budgetId: "o" })).toBe(2);
  expect(countActiveFilters({ period: "this-month" })).toBe(0);
});

it("dateRangeError so aparece quando a data inicial e depois da final", () => {
  expect(dateRangeError({ dateFrom: "2026-03-02", dateTo: "2026-03-01" })).toBe("A data inicial é depois da data final.");
  expect(dateRangeError({ dateFrom: "2026-03-01", dateTo: "2026-03-01" })).toBeUndefined();
  expect(dateRangeError({ dateFrom: "2026-03-01" })).toBeUndefined();
});

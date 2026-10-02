import { describe, expect, it } from "vitest";

import {
  countActiveFilters,
  dateRangeError,
  readState,
  resolvePeriod,
  toReportFilters,
  writeState,
  type ReportState,
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

describe("resolvePeriod", () => {
  const state = (period: ReportState["period"], extra: Partial<ReportState> = {}): ReportState => ({ period, ...extra });

  it("este mes vai do dia 1 ao ultimo dia", () => {
    expect(resolvePeriod(state("this-month"), "2026-03-15")).toEqual({ dateFrom: "2026-03-01", dateTo: "2026-03-31" });
    expect(resolvePeriod(state("this-month"), "2026-04-30")).toEqual({ dateFrom: "2026-04-01", dateTo: "2026-04-30" });
  });

  it("fevereiro em ano bissexto e em ano comum", () => {
    expect(resolvePeriod(state("this-month"), "2028-02-10").dateTo).toBe("2028-02-29");
    expect(resolvePeriod(state("this-month"), "2026-02-10").dateTo).toBe("2026-02-28");
  });

  it("mes passado em janeiro e dezembro do ano anterior", () => {
    expect(resolvePeriod(state("last-month"), "2026-01-05")).toEqual({ dateFrom: "2025-12-01", dateTo: "2025-12-31" });
    expect(resolvePeriod(state("last-month"), "2026-03-31")).toEqual({ dateFrom: "2026-02-01", dateTo: "2026-02-28" });
  });

  it("este ano vai de 1 de janeiro a 31 de dezembro", () => {
    expect(resolvePeriod(state("this-year"), "2026-07-04")).toEqual({ dateFrom: "2026-01-01", dateTo: "2026-12-31" });
  });

  it("personalizado usa as datas digitadas, mesmo incompletas", () => {
    expect(resolvePeriod(state("custom", { dateFrom: "2026-01-02" }), "2026-07-04")).toEqual({
      dateFrom: "2026-01-02",
      dateTo: undefined,
    });
  });
});

it("toReportFilters junta o periodo e os filtros e ignora campos vazios", () => {
  expect(toReportFilters({ period: "this-year", accountId: "a", tagId: "t" }, "2026-03-15")).toEqual({
    dateFrom: "2026-01-01",
    dateTo: "2026-12-31",
    accountId: "a",
    tagId: "t",
  });
  expect(toReportFilters({ period: "custom" }, "2026-03-15")).toEqual({});
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

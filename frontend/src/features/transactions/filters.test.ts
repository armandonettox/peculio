import { describe, expect, it } from "vitest";

import { countActiveFilters, dateRangeError, readFilters, writeFilters } from "./filters";

const params = (query: string) => new URLSearchParams(query);

describe("readFilters", () => {
  it("le cada filtro da URL", () => {
    expect(readFilters(params("conta=a1&categoria=c1&tag=t1&de=2026-01-01&ate=2026-01-31&busca=pao&min=10.00&max=99.90"))).toEqual({
      accountId: "a1",
      categoryId: "c1",
      tagId: "t1",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      q: "pao",
      minAmount: "10.00",
      maxAmount: "99.90",
    });
  });

  it("URL sem filtros devolve objeto vazio", () => {
    expect(readFilters(params(""))).toEqual({});
  });

  it("ignora parametros que nao sao filtros e valores vazios", () => {
    expect(readFilters(params("pagina=3&conta=&busca=x"))).toEqual({ q: "x" });
  });
});

describe("writeFilters", () => {
  it("acrescenta e troca filtros sem perder os outros", () => {
    const first = writeFilters(params(""), { accountId: "a1", q: "pao" });
    const second = writeFilters(first, { q: "leite", tagId: "t1" });
    expect(readFilters(second)).toEqual({ accountId: "a1", q: "leite", tagId: "t1" });
  });

  it("valor vazio ou undefined remove o filtro", () => {
    const start = params("conta=a1&busca=pao");
    expect(readFilters(writeFilters(start, { q: "" }))).toEqual({ accountId: "a1" });
    expect(readFilters(writeFilters(start, { accountId: undefined }))).toEqual({ q: "pao" });
  });

  it("campo fora do patch fica como estava", () => {
    expect(readFilters(writeFilters(params("conta=a1"), { q: "x" })).accountId).toBe("a1");
  });

  it("nao mexe nos parametros da URL que nao sao filtros", () => {
    expect(writeFilters(params("outro=1"), { q: "x" }).get("outro")).toBe("1");
  });

  it("nao altera o objeto original", () => {
    const original = params("conta=a1");
    writeFilters(original, { conta: undefined } as never);
    writeFilters(original, { accountId: undefined });
    expect(original.get("conta")).toBe("a1");
  });
});

describe("countActiveFilters", () => {
  it("conta so os preenchidos", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ accountId: "a", q: "x", minAmount: "" })).toBe(2);
  });
});

describe("dateRangeError", () => {
  it("aceita periodo valido, igual ou aberto", () => {
    expect(dateRangeError({ dateFrom: "2026-01-01", dateTo: "2026-01-31" })).toBeUndefined();
    expect(dateRangeError({ dateFrom: "2026-01-01", dateTo: "2026-01-01" })).toBeUndefined();
    expect(dateRangeError({ dateFrom: "2026-01-01" })).toBeUndefined();
    expect(dateRangeError({ dateTo: "2026-01-01" })).toBeUndefined();
  });

  it("recusa inicio depois do fim", () => {
    expect(dateRangeError({ dateFrom: "2026-02-01", dateTo: "2026-01-31" })).toBe(
      "A data inicial é depois da data final.",
    );
  });

  it("compara ano e mes corretamente", () => {
    expect(dateRangeError({ dateFrom: "2026-12-01", dateTo: "2027-01-01" })).toBeUndefined();
    expect(dateRangeError({ dateFrom: "2027-01-01", dateTo: "2026-12-31" })).toBeDefined();
  });
});

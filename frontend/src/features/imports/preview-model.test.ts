import { describe, expect, it } from "vitest";

import type { ImportRow } from "@/api/imports";
import { makeRow } from "@/test-utils/imports-api";
import {
  PAGE_SIZE,
  allSelectable,
  countsParts,
  entriesText,
  isSelectable,
  newRows,
  pageOf,
  rowsToImport,
  statusLabel,
} from "./preview-model";

const rows: ImportRow[] = [
  makeRow({ index: 2, status: "new" }),
  makeRow({ index: 3, status: "duplicate", duplicate_kind: "similar" }),
  makeRow({ index: 4, status: "duplicate", duplicate_kind: "same_id", external_id: "F1" }),
  makeRow({ index: 5, status: "error", date: null, amount: null, reason: "Valor invalido" }),
  makeRow({ index: 6, status: "new", external_id: "F2", description: "Salario", amount: "1000.00", date: "2026-03-06" }),
];

describe("selecao", () => {
  it("so as novas vem marcadas", () => {
    expect([...newRows(rows)]).toEqual([2, 6]);
  });

  it("todas inclui as repetidas mas nunca as com erro", () => {
    expect([...allSelectable(rows)]).toEqual([2, 3, 4, 6]);
  });

  it("linha com erro nao e marcavel", () => {
    expect(rows.map(isSelectable)).toEqual([true, true, true, false, true]);
  });

  it("sem linhas nao ha selecao", () => {
    expect(newRows([]).size).toBe(0);
    expect(allSelectable([]).size).toBe(0);
  });
});

describe("statusLabel", () => {
  it("diz a situacao por escrito, separando repetida de ja importada", () => {
    expect(rows.map(statusLabel)).toEqual(["Nova", "Parece repetida", "Já importada", "Erro", "Nova"]);
  });
});

describe("rowsToImport", () => {
  it("manda so as marcadas, na ordem do arquivo, com identificador do banco quando ha", () => {
    expect(rowsToImport(rows, new Set([6, 2]))).toEqual([
      { date: "2026-03-05", description: rows[0].description, amount: "-50.00", external_id: null },
      { date: "2026-03-06", description: "Salario", amount: "1000.00", external_id: "F2" },
    ]);
  });

  it("uma repetida marcada a mao vai junto", () => {
    expect(rowsToImport(rows, new Set([3])).map((row) => row.description)).toEqual([rows[1].description]);
  });

  it("linha com erro nunca vai, mesmo que o indice dela esteja na selecao", () => {
    expect(rowsToImport(rows, new Set([5]))).toEqual([]);
  });

  it("linha com erro que ainda traz data e valor (ex: data longe demais) tambem nao vai", () => {
    const withData = [
      makeRow({ index: 2, status: "error", date: "2099-01-01", amount: "-5.00", reason: "Data muito longe no futuro" }),
      makeRow({ index: 3, status: "new" }),
    ];
    expect(rowsToImport(withData, new Set([2, 3])).map((row) => row.date)).toEqual(["2026-03-05"]);
  });

  it("nada marcado nao manda nada", () => {
    expect(rowsToImport(rows, new Set())).toEqual([]);
  });

  it("indices que nao existem sao ignorados", () => {
    expect(rowsToImport(rows, new Set([99]))).toEqual([]);
  });
});

describe("pageOf", () => {
  const many = Array.from({ length: 250 }, (_, n) => makeRow({ index: n + 2 }));

  it("pagina de 100 em 100", () => {
    expect(PAGE_SIZE).toBe(100);
    const first = pageOf(many, 0);
    expect([first.rows.length, first.page, first.pages, first.first, first.last]).toEqual([100, 0, 3, 1, 100]);
    const last = pageOf(many, 2);
    expect([last.rows.length, last.page, last.first, last.last]).toEqual([50, 2, 201, 250]);
    expect(last.rows[0].index).toBe(202);
  });

  it("pagina fora do intervalo vira a mais proxima", () => {
    expect(pageOf(many, 9).page).toBe(2);
    expect(pageOf(many, -3).page).toBe(0);
  });

  it("exatamente uma pagina cheia nao cria pagina vazia", () => {
    const exact = Array.from({ length: 100 }, (_, n) => makeRow({ index: n + 2 }));
    expect(pageOf(exact, 0).pages).toBe(1);
    expect(pageOf(exact, 1).page).toBe(0);
  });

  it("sem linhas ha uma pagina vazia", () => {
    const empty = pageOf([], 0);
    expect([empty.rows.length, empty.pages, empty.first, empty.last]).toEqual([0, 1, 0, 0]);
  });

  it("aceita outro tamanho de pagina", () => {
    expect(pageOf(rows, 1, 2).rows.map((row) => row.index)).toEqual([4, 5]);
  });
});

describe("entriesText", () => {
  it("singular e plural", () => {
    expect(entriesText(0)).toBe("0 lançamentos");
    expect(entriesText(1)).toBe("1 lançamento");
    expect(entriesText(2)).toBe("2 lançamentos");
  });
});

describe("countsParts", () => {
  it("plural", () => {
    expect(countsParts({ new: 4, duplicate: 2, error: 3 })).toEqual({ news: "4 novas", rest: "2 repetidas · 3 com erro" });
  });

  it("singular de nova e de repetida (com erro nao varia)", () => {
    expect(countsParts({ new: 1, duplicate: 1, error: 1 })).toEqual({ news: "1 nova", rest: "1 repetida · 1 com erro" });
  });

  it("zero e plural", () => {
    expect(countsParts({ new: 0, duplicate: 0, error: 0 })).toEqual({ news: "0 novas", rest: "0 repetidas · 0 com erro" });
  });
});

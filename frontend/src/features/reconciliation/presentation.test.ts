import { describe, expect, it } from "vitest";

import type { ClosedReconciliation, ReconciliationRow, ReconciliationView } from "@/api/reconciliation";
import {
  adjustmentPreview,
  clearedCount,
  differenceInfo,
  entriesText,
  historyStatus,
  idsToChange,
  lockedText,
  signOf,
  truncatedText,
} from "./presentation";

const clean = (text: string) => text.replace(/\s/g, " ");

function row(id: string, cleared: boolean): ReconciliationRow {
  return { split_id: id, transaction_id: `t-${id}`, date: "2026-03-10", description: "x", amount: "-10.00", cleared };
}

describe("signOf", () => {
  it.each([
    ["0", 0],
    ["0.00", 0],
    ["-0.00", 0],
    ["12.50", 1],
    ["0.01", 1],
    ["-0.01", -1],
    ["-300.00", -1],
  ])("%s", (value, expected) => expect(signOf(value)).toBe(expected));
});

describe("differenceInfo", () => {
  it("zero bate com o extrato", () => {
    expect(differenceInfo("0.00", "BRL")).toEqual({ tone: "ok", text: "O conferido bate com o extrato." });
  });

  it("positivo: o extrato tem mais", () => {
    const info = differenceInfo("50.00", "BRL");
    expect(info.tone).toBe("statement_more");
    expect(clean(info.text)).toBe("O extrato tem R$ 50,00 a mais do que o conferido.");
  });

  it("negativo: o conferido tem mais, sem sinal no texto", () => {
    const info = differenceInfo("-20.00", "BRL");
    expect(info.tone).toBe("cleared_more");
    expect(clean(info.text)).toBe("O conferido tem R$ 20,00 a mais do que o extrato.");
  });
});

describe("adjustmentPreview", () => {
  it("sem diferenca nao ha ajuste", () => {
    expect(adjustmentPreview("0.00", "BRL")).toBeNull();
  });

  it("falta entrada: deposito do valor", () => {
    const preview = adjustmentPreview("30.00", "BRL");
    expect(preview?.kind).toBe("deposit");
    expect(preview?.amount).toBe("30.00");
    expect(clean(preview?.text ?? "")).toBe("uma entrada de R$ 30,00");
  });

  it("falta saida: retirada do valor positivo", () => {
    const preview = adjustmentPreview("-20.00", "BRL");
    expect(preview?.kind).toBe("withdrawal");
    expect(preview?.amount).toBe("20.00");
    expect(clean(preview?.text ?? "")).toBe("uma saída de R$ 20,00");
  });
});

describe("marcar todos", () => {
  const rows = [row("a", true), row("b", false), row("c", false)];

  it("marcar leva so os que faltam", () => expect(idsToChange(rows, true)).toEqual(["b", "c"]));
  it("desmarcar leva so os marcados", () => expect(idsToChange(rows, false)).toEqual(["a"]));
  it("conta os conferidos", () => expect(clearedCount(rows)).toBe(1));
  it("lista vazia nao muda nada", () => expect(idsToChange([], true)).toEqual([]));
});

describe("textos", () => {
  it("singular e plural", () => {
    expect(entriesText(1)).toBe("1 lançamento");
    expect(entriesText(3)).toBe("3 lançamentos");
    expect(lockedText(0)).toBe("Nenhum lançamento travado");
    expect(lockedText(1)).toBe("1 lançamento travado");
    expect(lockedText(2)).toBe("2 lançamentos travados");
  });

  it("aviso de lista cortada so quando cortou", () => {
    const view = { truncated: false, rows: [row("a", false)], total_rows: 1 } as ReconciliationView;
    expect(truncatedText(view)).toBeNull();
    expect(truncatedText({ ...view, truncated: true, total_rows: 1500 })).toContain("1 de 1500");
  });

  it("situacao no historico", () => {
    const item = { invalidated_at: null } as ClosedReconciliation;
    expect(historyStatus(item)).toEqual({ label: "Fechada", active: true });
    expect(historyStatus({ ...item, invalidated_at: "2026-03-01T10:00:00Z" })).toEqual({ label: "Desfeita", active: false });
  });
});

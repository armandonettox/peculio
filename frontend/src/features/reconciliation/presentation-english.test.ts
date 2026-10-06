import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/i18n";
import { adjustmentPreview, differenceInfo, historyStatus, lockedText, truncatedText } from "./presentation";

// A logica de conciliacao no idioma ingles: diferenca, ajuste, situacao do historico e travados.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("diferenca e ajuste", () => {
  it("texto da diferenca nos tres sentidos", () => {
    expect(differenceInfo("0.00", "USD").text).toBe("The cleared total matches the statement.");
    expect(differenceInfo("50.00", "USD").text).toBe("The statement has $50.00 more than the cleared total.");
    expect(differenceInfo("-50.00", "USD").text).toBe("The cleared total has $50.00 more than the statement.");
  });

  it("preview do ajuste", () => {
    expect(adjustmentPreview("50.00", "USD")?.text).toBe("an income of $50.00");
    expect(adjustmentPreview("-50.00", "USD")?.text).toBe("an expense of $50.00");
    expect(adjustmentPreview("0.00", "USD")).toBeNull();
  });
});

describe("historico e travados", () => {
  it("situacao desfeita ou fechada", () => {
    expect(historyStatus({ invalidated_at: null } as never)).toEqual({ label: "Closed", active: true });
    expect(historyStatus({ invalidated_at: "2026-01-01" } as never)).toEqual({ label: "Undone", active: false });
  });

  it("travados no singular, plural e zero", () => {
    expect(lockedText(0)).toBe("No locked transactions");
    expect(lockedText(1)).toBe("1 transaction locked");
    expect(lockedText(3)).toBe("3 transactions locked");
  });

  it("truncado avisa quantos faltam", () => {
    expect(truncatedText({ truncated: true, rows: [1, 2], total_rows: 10 } as never)).toBe(
      "Showing 2 of 10 open transactions. Check and close these; the others appear next.",
    );
    expect(truncatedText({ truncated: false } as never)).toBeNull();
  });
});

describe("o mesmo codigo em portugues", () => {
  it("volta aos textos brasileiros", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(differenceInfo("0.00", "BRL").text).toBe("O conferido bate com o extrato.");
    expect(lockedText(0)).toBe("Nenhum lançamento travado");
  });
});

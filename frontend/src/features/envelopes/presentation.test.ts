import { describe, expect, it } from "vitest";

import { makeEnvelope } from "@/test-utils/envelopes-api";
import {
  availableLabel,
  availableState,
  givers,
  monthParam,
  parseAllocation,
  signOf,
  toBudgetHint,
  toBudgetState,
  toInputText,
} from "./presentation";

describe("signOf", () => {
  it.each([
    ["12.50", 1],
    ["7", 1],
    ["0.01", 1],
    ["-12.50", -1],
    ["-0.01", -1],
    ["0", 0],
    ["0.00", 0],
    ["-0.00", 0],
    ["000", 0],
    ["", 0],
    ["abc", 0],
    ["1,5", 0],
  ])("%s -> %i", (text, expected) => {
    expect(signOf(text)).toBe(expected);
  });
});

describe("A orcar", () => {
  it("negativo, zero e positivo", () => {
    expect(toBudgetState({ to_budget: "-0.01" })).toBe("negative");
    expect(toBudgetState({ to_budget: "0.00" })).toBe("zero");
    expect(toBudgetState({ to_budget: "700.00" })).toBe("positive");
  });

  it("cada situacao tem uma frase diferente", () => {
    const texts = (["negative", "zero", "positive"] as const).map(toBudgetHint);
    expect(new Set(texts).size).toBe(3);
    expect(texts[0]).toMatch(/mais do que tem/);
    expect(texts[1]).toBe("Tudo distribuído.");
  });
});

describe("situacao do envelope", () => {
  it("estourou, zerado ou normal, e so os dois primeiros tem rotulo", () => {
    const over = makeEnvelope("A", { allocated: 100, spent: 130 });
    const empty = makeEnvelope("B", { allocated: 100, spent: 100 });
    const ok = makeEnvelope("C", { allocated: 100, spent: 40 });
    expect(availableState(over)).toBe("overspent");
    expect(availableState(empty)).toBe("empty");
    expect(availableState(ok)).toBe("ok");
    expect(availableLabel("overspent")).toBe("Estourou");
    expect(availableLabel("empty")).toBe("Zerado");
    expect(availableLabel("ok")).toBeNull();
  });
});

describe("parseAllocation", () => {
  it("vazio e zero (limpa)", () => {
    expect(parseAllocation("", 2)).toEqual({ ok: true, value: "0" });
    expect(parseAllocation("   ", 2)).toEqual({ ok: true, value: "0" });
  });

  it("aceita formato brasileiro e negativo (tirar do que passou)", () => {
    expect(parseAllocation("1.234,50", 2)).toEqual({ ok: true, value: "1234.50" });
    expect(parseAllocation("-60,00", 2)).toEqual({ ok: true, value: "-60.00" });
  });

  it("recusa o que nao e valor", () => {
    expect(parseAllocation("abc", 2).ok).toBe(false);
    expect(parseAllocation("1,234", 2).ok).toBe(false);
  });
});

describe("pequenos auxiliares", () => {
  it("texto do campo, mes da API e quem pode dar dinheiro", () => {
    expect(toInputText("300.00")).toBe("300,00");
    expect(monthParam("2026-03-01")).toBe("2026-03");
    const group = {
      envelopes: [makeEnvelope("Tem", { allocated: 50 }), makeEnvelope("Zero"), makeEnvelope("Estourou", { spent: 10 })],
    };
    expect(givers(group).map((item) => item.name)).toEqual(["Tem"]);
  });
});

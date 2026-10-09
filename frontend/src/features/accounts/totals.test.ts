import { describe, expect, it } from "vitest";

import type { Account } from "@/api/accounts";
import { totalsByCurrency } from "./totals";

function account(overrides: Partial<Account>): Account {
  return {
    id: crypto.randomUUID(),
    name: "Conta",
    type: "asset",
    role: "checking",
    currency_code: "BRL",
    active: true,
    in_envelopes: true,
    iban: null,
    account_number: null,
    notes: null,
    opening_balance: "0.00",
    opening_balance_date: null,
    balance: "0.00",
    closing_day: null,
    due_day: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("totalsByCurrency", () => {
  it("soma contas da mesma moeda sem erro de float", () => {
    const accounts = Array.from({ length: 10 }, () => account({ balance: "0.10" }));
    expect(totalsByCurrency(accounts)).toEqual([{ currency: "BRL", total: "1.00" }]);
  });

  it("nao mistura moedas", () => {
    const result = totalsByCurrency([
      account({ balance: "100.00" }),
      account({ currency_code: "USD", balance: "50.00" }),
      account({ balance: "20.50" }),
    ]);
    expect(result).toEqual([
      { currency: "BRL", total: "120.50" },
      { currency: "USD", total: "50.00" },
    ]);
  });

  it("divida (saldo negativo) reduz o total", () => {
    const result = totalsByCurrency([
      account({ balance: "1000.00" }),
      account({ type: "liability", role: "debt", balance: "-400.00" }),
    ]);
    expect(result).toEqual([{ currency: "BRL", total: "600.00" }]);
  });

  it("contas arquivadas ficam de fora", () => {
    const result = totalsByCurrency([account({ balance: "10.00" }), account({ active: false, balance: "999.00" })]);
    expect(result).toEqual([{ currency: "BRL", total: "10.00" }]);
  });

  it("respeita as casas da moeda (iene sem centavos)", () => {
    const result = totalsByCurrency(
      [account({ currency_code: "JPY", balance: "100" }), account({ currency_code: "JPY", balance: "250" })],
      { JPY: 0 },
    );
    expect(result).toEqual([{ currency: "JPY", total: "350" }]);
  });

  it("sem contas nao ha totais", () => {
    expect(totalsByCurrency([])).toEqual([]);
  });

  it("ordena por codigo da moeda", () => {
    const result = totalsByCurrency([account({ currency_code: "USD" }), account({ currency_code: "BRL" })]);
    expect(result.map((r) => r.currency)).toEqual(["BRL", "USD"]);
  });
});

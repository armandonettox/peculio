import { describe, expect, it } from "vitest";

import {
  ACTION_KINDS,
  actionLabel,
  fieldLabel,
  FIELD_OPS,
  FIELDS,
  opLabel,
  actionSummary,
  previewChanges,
  triggerSummary,
  type NameLookups,
} from "./presentation";

const lookups: NameLookups = {
  accounts: new Map([["acc-1", "Nubank"]]),
  categories: new Map([["cat-1", "Mercado"]]),
  tags: new Map([["tag-1", "casa"]]),
  budgets: new Map([["bud-1", "Casa"]]),
  bills: new Map([["bill-1", "Netflix"]]),
};

describe("triggerSummary", () => {
  it.each([
    [{ field: "description", op: "contains", value: "mercado" }, 'Descrição contém "mercado"'],
    [{ field: "description", op: "starts_with", value: "pix" }, 'Descrição começa com "pix"'],
    [{ field: "counterparty", op: "equals", value: "Padaria" }, 'Quem recebeu ou pagou é igual a "Padaria"'],
    [{ field: "amount", op: "greater_than", value: "100.50" }, "Valor é maior que 100,50"],
    [{ field: "amount", op: "less_than", value: "10.00" }, "Valor é menor que 10,00"],
    [{ field: "account", op: "is", value: "acc-1" }, "Conta é Nubank"],
    [{ field: "account", op: "is", value: "sumiu" }, "Conta é item removido"],
    [{ field: "type", op: "is", value: "withdrawal" }, "Tipo é Saída"],
    [{ field: "type", op: "is", value: "deposit" }, "Tipo é Entrada"],
    [{ field: "type", op: "is", value: "transfer" }, "Tipo é Transferência"],
  ] as const)("%j -> %s", (trigger, expected) => {
    expect(triggerSummary(trigger, lookups)).toBe(expected);
  });
});

describe("actionSummary", () => {
  it.each([
    [{ kind: "set_category", target_id: "cat-1" }, "Categoria: Mercado"],
    [{ kind: "add_tag", target_id: "tag-1" }, "Tag: casa"],
    [{ kind: "set_budget", target_id: "bud-1" }, "Orçamento: Casa"],
    [{ kind: "set_bill", target_id: "bill-1" }, "Conta a pagar: Netflix"],
    [{ kind: "set_category", target_id: "sumiu" }, "Categoria: item removido"],
    [{ kind: "add_tag", target_id: "sumiu" }, "Tag: item removido"],
    [{ kind: "set_budget", target_id: "sumiu" }, "Orçamento: item removido"],
    [{ kind: "set_bill", target_id: "sumiu" }, "Conta a pagar: item removido"],
  ] as const)("%j -> %s", (action, expected) => {
    expect(actionSummary(action, lookups)).toBe(expected);
  });
});

it("todo campo, operacao e acao tem rotulo", () => {
  for (const field of FIELDS) {
    expect(fieldLabel(field)).toBeTruthy();
    expect(FIELD_OPS[field].length).toBeGreaterThan(0);
    for (const op of FIELD_OPS[field]) expect(opLabel(op)).toBeTruthy();
  }
  for (const kind of ACTION_KINDS) expect(actionLabel(kind)).toBeTruthy();
});

describe("previewChanges", () => {
  const none = { category_id: null, budget_id: null, bill_id: null, add_tag_ids: [] };

  it("uma linha por campo, na ordem categoria, orcamento, conta a pagar e tags", () => {
    expect(
      previewChanges(
        { category_id: "cat-1", budget_id: "bud-1", bill_id: "bill-1", add_tag_ids: ["tag-1", "sumiu"] },
        lookups,
      ),
    ).toEqual(["Categoria: Mercado", "Orçamento: Casa", "Conta a pagar: Netflix", "Tag: casa", "Tag: item removido"]);
  });

  it("campos que nao mudam nao aparecem", () => {
    expect(previewChanges(none, lookups)).toEqual([]);
    expect(previewChanges({ ...none, budget_id: "bud-1" }, lookups)).toEqual(["Orçamento: Casa"]);
    expect(previewChanges({ ...none, add_tag_ids: ["tag-1"] }, lookups)).toEqual(["Tag: casa"]);
  });
});

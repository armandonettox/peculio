import { describe, expect, it } from "vitest";

import { makeRule } from "@/test-utils/rules-api";
import {
  changesFor,
  draftFromRule,
  emptyDraft,
  newAction,
  newTrigger,
  validateDraft,
  type RuleDraft,
} from "./form-model";

const CATEGORY = "c0000000-0000-4000-8000-000000000001";
const TAG = "t0000000-0000-4000-8000-000000000001";
const TAG_2 = "t0000000-0000-4000-8000-000000000002";
const BUDGET = "b0000000-0000-4000-8000-000000000001";

function valid(overrides: Partial<RuleDraft> = {}): RuleDraft {
  const draft = emptyDraft();
  draft.name = "Mercado";
  draft.triggers = [{ field: "description", op: "contains", value: "mercado" }];
  draft.actions = [{ kind: "set_category", targetId: CATEGORY }];
  return { ...draft, ...overrides };
}

describe("rascunho inicial", () => {
  it("comeca com um gatilho de descricao, uma acao de categoria e tudo ligado", () => {
    const draft = emptyDraft();
    expect(draft).toMatchObject({ name: "", groupId: "", position: "0", matchMode: "all", stopProcessing: false, active: true });
    expect(draft.triggers).toEqual([{ field: "description", op: "contains", value: "" }]);
    expect(draft.actions).toEqual([{ kind: "set_category", targetId: "" }]);
  });

  it("gatilho novo de cada campo comeca com a primeira operacao valida", () => {
    expect(newTrigger("amount")).toEqual({ field: "amount", op: "greater_than", value: "" });
    expect(newTrigger("account")).toEqual({ field: "account", op: "is", value: "" });
    expect(newTrigger("type")).toEqual({ field: "type", op: "is", value: "withdrawal" });
  });

  it("acao nova pula as de alvo unico ja usadas e cai em tag", () => {
    expect(newAction([]).kind).toBe("set_category");
    expect(newAction([{ kind: "set_category", targetId: "x" }]).kind).toBe("set_budget");
    expect(
      newAction([
        { kind: "set_category", targetId: "x" },
        { kind: "set_budget", targetId: "y" },
      ]).kind,
    ).toBe("set_bill");
    expect(
      newAction([
        { kind: "set_category", targetId: "x" },
        { kind: "set_budget", targetId: "y" },
        { kind: "set_bill", targetId: "z" },
      ]).kind,
    ).toBe("add_tag");
  });
});

describe("validateDraft", () => {
  it("monta o corpo da API", () => {
    const { payload, errors } = validateDraft(
      valid({
        name: "  Mercado  ",
        groupId: "g1",
        position: "3",
        matchMode: "any",
        stopProcessing: true,
        active: false,
        triggers: [
          { field: "description", op: "starts_with", value: "  pix  " },
          { field: "amount", op: "greater_than", value: "1.234,50" },
          { field: "type", op: "is", value: "deposit" },
        ],
        actions: [
          { kind: "set_category", targetId: CATEGORY },
          { kind: "add_tag", targetId: TAG },
        ],
      }),
    );
    expect(errors.triggers.concat(errors.actions).every((e) => e === undefined)).toBe(true);
    expect(payload).toEqual({
      name: "Mercado",
      group_id: "g1",
      position: 3,
      match_mode: "any",
      stop_processing: true,
      active: false,
      triggers: [
        { field: "description", op: "starts_with", value: "pix" },
        { field: "amount", op: "greater_than", value: "1234.50" },
        { field: "type", op: "is", value: "deposit" },
      ],
      actions: [
        { kind: "set_category", target_id: CATEGORY },
        { kind: "add_tag", target_id: TAG },
      ],
    });
  });

  it("sem grupo vira group_id null", () => {
    expect(validateDraft(valid()).payload?.group_id).toBeNull();
  });

  it.each([
    ["nome vazio", { name: "   " }, "name", "Informe o nome da regra."],
    ["ordem com letra", { position: "a" }, "position", "Informe um número inteiro de 0 a 100000."],
    ["ordem negativa", { position: "-1" }, "position", "Informe um número inteiro de 0 a 100000."],
    ["ordem grande demais", { position: "100001" }, "position", "Informe um número inteiro de 0 a 100000."],
    ["ordem decimal", { position: "1,5" }, "position", "Informe um número inteiro de 0 a 100000."],
  ] as const)("recusa %s", (_label, overrides, field, message) => {
    const result = validateDraft(valid(overrides));
    expect(result.payload).toBeNull();
    expect(result.errors[field]).toBe(message);
  });

  it("ordem 0 e 100000 valem", () => {
    expect(validateDraft(valid({ position: "0" })).payload?.position).toBe(0);
    expect(validateDraft(valid({ position: "100000" })).payload?.position).toBe(100000);
  });

  it.each([
    [{ field: "description", op: "contains", value: "  " }, "Informe o texto."],
    [{ field: "counterparty", op: "equals", value: "" }, "Informe o texto."],
    [{ field: "account", op: "is", value: "" }, "Escolha uma conta."],
    [{ field: "amount", op: "equals", value: "" }, "Informe o valor."],
    [{ field: "amount", op: "equals", value: "abc" }, "Valor inválido."],
    [{ field: "amount", op: "equals", value: "-5" }, "O valor não pode ser negativo."],
    [{ field: "amount", op: "equals", value: "1,234" }, undefined],
  ] as const)("gatilho %j -> %s", (trigger, message) => {
    const result = validateDraft(valid({ triggers: [{ ...trigger }] }));
    if (message === undefined) {
      // 1,234 tem 3 casas: o parser recusa com a propria mensagem, nao a nossa
      expect(result.errors.triggers[0]).toBeTruthy();
    } else {
      expect(result.errors.triggers[0]).toBe(message);
    }
    expect(result.payload).toBeNull();
  });

  it("valor zero vale em gatilho de valor", () => {
    const result = validateDraft(valid({ triggers: [{ field: "amount", op: "equals", value: "0" }] }));
    expect(result.payload?.triggers[0].value).toBe("0.00");
  });

  it("aponta o gatilho que errou sem marcar os outros", () => {
    const result = validateDraft(
      valid({
        triggers: [
          { field: "description", op: "contains", value: "ok" },
          { field: "account", op: "is", value: "" },
        ],
      }),
    );
    expect(result.errors.triggers).toEqual([undefined, "Escolha uma conta."]);
  });

  it.each([
    ["set_category", "Escolha a categoria."],
    ["add_tag", "Escolha a tag."],
    ["set_budget", "Escolha o orçamento."],
    ["set_bill", "Escolha a conta a pagar."],
  ] as const)("acao %s sem alvo pede a escolha", (kind, message) => {
    const result = validateDraft(valid({ actions: [{ kind, targetId: "" }] }));
    expect(result.errors.actions[0]).toBe(message);
    expect(result.payload).toBeNull();
  });

  it("recusa duas acoes de alvo unico do mesmo tipo", () => {
    const result = validateDraft(
      valid({
        actions: [
          { kind: "set_budget", targetId: BUDGET },
          { kind: "set_budget", targetId: "outro" },
        ],
      }),
    );
    expect(result.errors.actions).toEqual([undefined, "Só pode haver uma ação desse tipo."]);
  });

  it("recusa a mesma tag duas vezes mas aceita tags diferentes", () => {
    const repeated = validateDraft(
      valid({
        actions: [
          { kind: "add_tag", targetId: TAG },
          { kind: "add_tag", targetId: TAG },
        ],
      }),
    );
    expect(repeated.errors.actions).toEqual([undefined, "Essa tag já foi escolhida."]);
    const different = validateDraft(
      valid({
        actions: [
          { kind: "add_tag", targetId: TAG },
          { kind: "add_tag", targetId: TAG_2 },
        ],
      }),
    );
    expect(different.payload).not.toBeNull();
  });
});

describe("draftFromRule", () => {
  it("troca o ponto do valor pela virgula e guarda os ids", () => {
    const rule = makeRule({
      name: "Grande",
      group_id: "g1",
      position: 4,
      match_mode: "any",
      stop_processing: true,
      active: false,
      triggers: [{ field: "amount", op: "greater_than", value: "1000.50" }],
      actions: [{ kind: "add_tag", target_id: TAG }],
    });
    expect(draftFromRule(rule)).toEqual({
      name: "Grande",
      groupId: "g1",
      position: "4",
      matchMode: "any",
      stopProcessing: true,
      active: false,
      triggers: [{ field: "amount", op: "greater_than", value: "1000,50" }],
      actions: [{ kind: "add_tag", targetId: TAG }],
    });
  });

  it("ida e volta sem mexer em nada nao gera mudanca", () => {
    const rule = makeRule({
      triggers: [
        { field: "amount", op: "less_than", value: "50.00" },
        { field: "description", op: "contains", value: "pix" },
      ],
    });
    const { payload } = validateDraft(draftFromRule(rule));
    expect(payload).not.toBeNull();
    expect(changesFor(rule, payload!)).toEqual({});
  });
});

describe("changesFor", () => {
  const rule = makeRule({ name: "Mercado", group_id: "g1", position: 2 });
  const base = () => validateDraft(draftFromRule(rule)).payload!;

  it("manda so o que mudou", () => {
    expect(changesFor(rule, { ...base(), name: "Novo" })).toEqual({ name: "Novo" });
    expect(changesFor(rule, { ...base(), position: 9 })).toEqual({ position: 9 });
    expect(changesFor(rule, { ...base(), match_mode: "any" })).toEqual({ match_mode: "any" });
    expect(changesFor(rule, { ...base(), stop_processing: true })).toEqual({ stop_processing: true });
    expect(changesFor(rule, { ...base(), active: false })).toEqual({ active: false });
  });

  it("tirar do grupo manda group_id null", () => {
    expect(changesFor(rule, { ...base(), group_id: null })).toEqual({ group_id: null });
    expect(changesFor(rule, { ...base(), group_id: "g2" })).toEqual({ group_id: "g2" });
  });

  it("gatilhos e acoes vao inteiros quando mudam", () => {
    const triggers = [{ field: "type" as const, op: "is" as const, value: "deposit" }];
    expect(changesFor(rule, { ...base(), triggers })).toEqual({ triggers });
    const actions = [{ kind: "set_budget" as const, target_id: BUDGET }];
    expect(changesFor(rule, { ...base(), actions })).toEqual({ actions });
  });
});

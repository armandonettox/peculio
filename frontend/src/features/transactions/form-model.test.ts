import { describe, expect, it } from "vitest";

import { makeAccount } from "@/test-utils/accounts-api";
import { deposit, makeSplit, makeTransaction, transfer } from "@/test-utils/transaction-fixtures";
import {
  buildPayload,
  canSplit,
  emptyForm,
  emptySplit,
  foreignAccount,
  formFromTransaction,
  formatRemainder,
  hasErrors,
  remainder,
  validateForm,
  type FormContext,
  type FormState,
} from "./form-model";

const nubank = makeAccount({ id: "a1", name: "Nubank", currency_code: "BRL" });
const poupanca = makeAccount({ id: "a2", name: "Poupanca", currency_code: "BRL" });
const wise = makeAccount({ id: "a3", name: "Wise", currency_code: "USD" });
const divida = makeAccount({ id: "a4", name: "Financiamento", type: "liability", role: "loan", currency_code: "BRL" });
const dividaUsd = makeAccount({ id: "a5", name: "Divida em dolar", type: "liability", role: "debt", currency_code: "USD" });
const toquio = makeAccount({ id: "a6", name: "Toquio", currency_code: "JPY" });
const antiga = makeAccount({ id: "a7", name: "Antiga", active: false });

const ctx: FormContext = {
  accounts: [nubank, poupanca, wise, divida, dividaUsd, toquio, antiga],
  places: { BRL: 2, USD: 2, JPY: 0 },
};

const form = (overrides: Partial<FormState> = {}) =>
  emptyForm(ctx, {
    accountId: nubank.id,
    description: "Compra no mercado",
    counterpartyName: "Supermercado",
    amount: "50,00",
    ...overrides,
  });

const valid = (state: FormState) => expect(validateForm(state, ctx)).toEqual({});

describe("emptyForm", () => {
  it("comeca como saida de hoje, na primeira conta ativa que nao e divida", () => {
    const state = emptyForm({ ...ctx, accounts: [divida, antiga, nubank] });
    expect(state.kind).toBe("withdrawal");
    expect(state.accountId).toBe(nubank.id);
    expect(state.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(state.splits).toBeNull();
  });

  it("sem contas ativas fica sem conta escolhida", () => {
    expect(emptyForm({ ...ctx, accounts: [antiga] }).accountId).toBe("");
  });

  it("so ha divida ativa: usa a divida", () => {
    expect(emptyForm({ ...ctx, accounts: [divida] }).accountId).toBe(divida.id);
  });
});

describe("validateForm: campos basicos", () => {
  it("lancamento completo nao tem erros", () => {
    valid(form());
  });

  it("formulario vazio pede descricao, contraparte e valor", () => {
    const errors = validateForm(emptyForm(ctx), ctx);
    expect(errors.description).toBe("Informe a descrição.");
    expect(errors.counterparty).toBe("Informe para quem foi.");
    expect(errors.amount).toBe("Informe o valor.");
  });

  it("a mensagem da contraparte depende do tipo", () => {
    expect(validateForm(form({ kind: "deposit", counterpartyName: "" }), ctx).counterparty).toBe("Informe de quem veio.");
  });

  it.each([
    ["0", "Informe o valor maior que zero."],
    ["0,00", "Informe o valor maior que zero."],
    ["-5", "Informe o valor maior que zero."],
    ["abc", "Valor inválido."],
    ["10,555", "Use no máximo 2 casas decimais."],
  ])("valor %j mostra %j", (amount, message) => {
    expect(validateForm(form({ amount }), ctx).amount).toBe(message);
  });

  it("aceita o formato brasileiro", () => {
    valid(form({ amount: "1.234,50" }));
  });

  it("data vazia ou fora do formato e recusada", () => {
    expect(validateForm(form({ date: "" }), ctx).date).toBe("Informe uma data válida.");
    expect(validateForm(form({ date: "10/03/2026" }), ctx).date).toBe("Informe uma data válida.");
  });

  it("conta nao escolhida ou que nao existe e recusada", () => {
    expect(validateForm(form({ accountId: "" }), ctx).accountId).toBe("Escolha a conta.");
    expect(validateForm(form({ accountId: "inexistente" }), ctx).accountId).toBe("Escolha a conta.");
  });

  it("nome so de espacos conta como vazio", () => {
    expect(validateForm(form({ counterpartyName: "   " }), ctx).counterparty).toBeDefined();
    expect(validateForm(form({ description: "  " }), ctx).description).toBeDefined();
  });

  it("iene nao aceita centavos", () => {
    expect(validateForm(form({ accountId: toquio.id, amount: "100,5" }), ctx).amount).toBe("Esta moeda não tem centavos.");
    valid(form({ accountId: toquio.id, amount: "1.500" }));
  });
});

describe("validateForm: transferencia", () => {
  const base = { kind: "transfer" as const, counterpartyName: "", counterpartyAccountId: poupanca.id };

  it("entre contas na mesma moeda nao pede valor estrangeiro", () => {
    valid(form(base));
    expect(foreignAccount(form(base), ctx)).toBeNull();
  });

  it("pede a conta de destino", () => {
    expect(validateForm(form({ ...base, counterpartyAccountId: "" }), ctx).counterparty).toBe("Escolha a conta de destino.");
  });

  it("recusa origem igual ao destino", () => {
    expect(validateForm(form({ ...base, counterpartyAccountId: nubank.id }), ctx).counterparty).toBe(
      "A conta de destino precisa ser diferente da conta de origem.",
    );
  });

  it("entre moedas diferentes pede o valor que chega", () => {
    const state = form({ ...base, counterpartyAccountId: wise.id });
    expect(foreignAccount(state, ctx)).toBe(wise);
    expect(validateForm(state, ctx).foreignAmount).toBe("Informe o valor.");
    valid({ ...state, foreignAmount: "10,00" });
  });

  it("o valor que chega precisa ser maior que zero e respeitar a moeda de destino", () => {
    const state = form({ ...base, counterpartyAccountId: wise.id });
    expect(validateForm({ ...state, foreignAmount: "0" }, ctx).foreignAmount).toBe("Informe o valor maior que zero.");
    expect(validateForm({ ...state, foreignAmount: "1,005" }, ctx).foreignAmount).toBe("Use no máximo 2 casas decimais.");
    // Para o iene, sem centavos
    const toYen = form({ ...base, counterpartyAccountId: toquio.id, foreignAmount: "100,5" });
    expect(validateForm(toYen, ctx).foreignAmount).toBe("Esta moeda não tem centavos.");
  });
});

describe("validateForm: divida", () => {
  const pay = { ownCounterparty: true, counterpartyName: "" };

  it("pagar uma divida na mesma moeda", () => {
    valid(form({ ...pay, counterpartyAccountId: divida.id }));
  });

  it("pede para escolher a divida", () => {
    expect(validateForm(form({ ...pay, counterpartyAccountId: "" }), ctx).counterparty).toBe("Escolha a dívida.");
  });

  it("pagar divida em outra moeda pede o valor que chega", () => {
    const state = form({ ...pay, counterpartyAccountId: dividaUsd.id });
    expect(validateForm(state, ctx).foreignAmount).toBeDefined();
    valid({ ...state, foreignAmount: "20,00" });
  });

  it("receber de uma divida em outra moeda e recusado", () => {
    const state = form({ kind: "deposit", ...pay, counterpartyAccountId: dividaUsd.id });
    expect(validateForm(state, ctx).counterparty).toBe(
      "Para receber de uma dívida, as duas contas precisam ter a mesma moeda.",
    );
  });

  it("receber de uma divida na mesma moeda e aceito", () => {
    valid(form({ kind: "deposit", ...pay, counterpartyAccountId: divida.id }));
  });
});

describe("canSplit", () => {
  it("saida e entrada na mesma moeda podem ser divididas", () => {
    expect(canSplit(form(), ctx)).toBe(true);
    expect(canSplit(form({ kind: "deposit" }), ctx)).toBe(true);
  });

  it("transferencia e pagamento entre moedas nao", () => {
    expect(canSplit(form({ kind: "transfer", counterpartyAccountId: poupanca.id }), ctx)).toBe(false);
    expect(canSplit(form({ ownCounterparty: true, counterpartyAccountId: dividaUsd.id }), ctx)).toBe(false);
  });
});

describe("divisao", () => {
  const split = (description: string, amount: string) => emptySplit({ description, amount });
  const divided = (rows: ReturnType<typeof split>[], overrides: Partial<FormState> = {}) =>
    form({ description: "Compras da semana", amount: "100,00", splits: rows, ...overrides });

  it("linhas que somam o total sao aceitas, e o titulo e opcional", () => {
    valid(divided([split("Frutas", "60,00"), split("Limpeza", "40,00")]));
    valid(divided([split("Frutas", "60,00"), split("Limpeza", "40,00")], { description: "" }));
  });

  it("sem divisao a descricao continua obrigatoria", () => {
    expect(validateForm(form({ description: "" }), ctx).description).toBeDefined();
  });

  it("falta distribuir", () => {
    const errors = validateForm(divided([split("Frutas", "60,00"), split("Limpeza", "30,00")]), ctx);
    expect(errors.splitTotal?.replace(/\s/g, " ")).toBe("Falta distribuir R$ 10,00");
  });

  it("passou do total", () => {
    const errors = validateForm(divided([split("Frutas", "60,00"), split("Limpeza", "50,00")]), ctx);
    expect(errors.splitTotal?.replace(/\s/g, " ")).toBe("As linhas passam do total em R$ 10,00");
  });

  it("soma exata, sem erro de float", () => {
    valid(divided([split("a", "0,10"), split("b", "0,20")], { amount: "0,30" }));
  });

  it("cada linha precisa de descricao e valor", () => {
    const rows = [split("", "60,00"), split("Limpeza", "")];
    const errors = validateForm(divided(rows), ctx);
    expect(errors.splits?.[rows[0].key]).toEqual({ description: "Informe a descrição." });
    expect(errors.splits?.[rows[1].key]).toEqual({ amount: "Informe o valor." });
    // Enquanto as linhas tem erro, nao mostra o aviso de total
    expect(errors.splitTotal).toBeUndefined();
  });

  it("linha com valor zero ou invalido e recusada", () => {
    const rows = [split("a", "0"), split("b", "x")];
    const errors = validateForm(divided(rows), ctx);
    expect(errors.splits?.[rows[0].key]?.amount).toBe("Informe o valor maior que zero.");
    expect(errors.splits?.[rows[1].key]?.amount).toBe("Valor inválido.");
  });

  it("total invalido nao mostra aviso de distribuicao", () => {
    const errors = validateForm(divided([split("a", "10,00")], { amount: "abc" }), ctx);
    expect(errors.amount).toBeDefined();
    expect(errors.splitTotal).toBeUndefined();
  });

  it("remainder mostra quanto falta e ignora linhas vazias", () => {
    expect(remainder(divided([split("a", "30,00"), split("b", "")]), ctx)).toBe("70.00");
    expect(remainder(divided([split("a", "130,00")]), ctx)).toBe("-30.00");
    expect(remainder(divided([split("a", "100,00")]), ctx)).toBe("0.00");
  });

  it("remainder e nulo sem divisao ou com valor invalido", () => {
    expect(remainder(form(), ctx)).toBeNull();
    expect(remainder(divided([split("a", "x")]), ctx)).toBeNull();
    expect(remainder(divided([split("a", "10,00")], { amount: "" }), ctx)).toBeNull();
  });

  it("formatRemainder mostra sempre valor positivo na moeda da conta", () => {
    expect(formatRemainder("-30.00", "BRL").replace(/\s/g, " ")).toBe("R$ 30,00");
    expect(formatRemainder("12.50", "USD").replace(/\s/g, " ")).toBe("US$ 12,50");
  });
});

describe("hasErrors", () => {
  it("distingue vazio de com erro", () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ amount: "x" })).toBe(true);
  });
});

describe("buildPayload", () => {
  it("saida para um nome novo", () => {
    expect(buildPayload(form({ date: "2026-03-10", description: "  Compra  ", counterpartyName: " Supermercado " }), ctx)).toEqual({
      splits: [
        {
          type: "withdrawal",
          date: "2026-03-10",
          description: "Compra",
          amount: "50.00",
          currency_code: "BRL",
          account_id: nubank.id,
          counterparty_name: "Supermercado",
          category_id: null,
          tag_ids: [],
          notes: null,
        },
      ],
    });
  });

  it("converte o formato brasileiro e leva categoria, tags e nota", () => {
    const payload = buildPayload(
      form({ amount: "1.234,50", categoryId: "c1", tagIds: ["t1", "t2"], notes: "  anotacao  " }),
      ctx,
    );
    expect(payload.splits[0]).toMatchObject({ amount: "1234.50", category_id: "c1", tag_ids: ["t1", "t2"], notes: "anotacao" });
  });

  it("entrada usa o nome de quem pagou", () => {
    const split = buildPayload(form({ kind: "deposit", counterpartyName: "Empregador" }), ctx).splits[0];
    expect(split).toMatchObject({ type: "deposit", counterparty_name: "Empregador" });
  });

  it("transferencia manda a conta de destino e nunca um nome", () => {
    const split = buildPayload(
      form({ kind: "transfer", counterpartyName: "sobra", counterpartyAccountId: poupanca.id }),
      ctx,
    ).splits[0];
    expect(split).toMatchObject({ type: "transfer", counterparty_account_id: poupanca.id });
    expect(split).not.toHaveProperty("counterparty_name");
    expect(split).not.toHaveProperty("foreign_amount");
  });

  it("transferencia entre moedas leva o valor que chega e a moeda de destino", () => {
    const split = buildPayload(
      form({ kind: "transfer", amount: "500,00", counterpartyAccountId: wise.id, foreignAmount: "92,50" }),
      ctx,
    ).splits[0];
    expect(split).toMatchObject({ amount: "500.00", currency_code: "BRL", foreign_amount: "92.50", foreign_currency_code: "USD" });
  });

  it("pagar divida manda a conta, nao o nome digitado antes", () => {
    const split = buildPayload(
      form({ ownCounterparty: true, counterpartyName: "ignorado", counterpartyAccountId: divida.id }),
      ctx,
    ).splits[0];
    expect(split).toMatchObject({ type: "withdrawal", counterparty_account_id: divida.id });
    expect(split).not.toHaveProperty("counterparty_name");
  });

  it("a moeda do lancamento e a da conta", () => {
    expect(buildPayload(form({ accountId: wise.id, amount: "20,00" }), ctx).splits[0].currency_code).toBe("USD");
    expect(buildPayload(form({ accountId: toquio.id, amount: "1.500" }), ctx).splits[0]).toMatchObject({
      currency_code: "JPY",
      amount: "1500",
    });
  });

  it("lancamento dividido leva o titulo e uma linha por divisao, na ordem", () => {
    const payload = buildPayload(
      form({
        description: " Compras da semana ",
        amount: "100,00",
        splits: [
          emptySplit({ description: "Frutas", amount: "60,00", categoryId: "c1", tagIds: ["t1"], notes: "boas" }),
          emptySplit({ description: "Limpeza", amount: "40,00" }),
        ],
      }),
      ctx,
    );
    expect(payload.title).toBe("Compras da semana");
    expect(payload.splits.map((s) => [s.description, s.amount, s.category_id, s.notes])).toEqual([
      ["Frutas", "60.00", "c1", "boas"],
      ["Limpeza", "40.00", null, null],
    ]);
    expect(new Set(payload.splits.map((s) => s.counterparty_name))).toEqual(new Set(["Supermercado"]));
  });

  it("titulo em branco no lancamento dividido vira nulo", () => {
    const payload = buildPayload(
      form({ description: "  ", splits: [emptySplit({ description: "a", amount: "50,00" })] }),
      ctx,
    );
    expect(payload.title).toBeNull();
  });

  it("lanca erro se chamado com formulario invalido, em vez de mandar lixo", () => {
    expect(() => buildPayload(form({ amount: "abc" }), ctx)).toThrow();
    expect(() => buildPayload(form({ accountId: "" }), ctx)).toThrow();
  });
});

describe("formFromTransaction", () => {
  const roundTrip = (transaction: ReturnType<typeof makeTransaction>) => {
    const loaded = formFromTransaction(transaction, ctx);
    if (!loaded.ok) throw new Error(loaded.reason);
    expect(validateForm(loaded.state, ctx)).toEqual({});
    return buildPayload(loaded.state, ctx);
  };

  it("saida: reabre e remonta o mesmo corpo", () => {
    const t = makeTransaction({}, [
      {
        date: "2026-03-10",
        description: "Compra no mercado",
        amount: "1234.50",
        source_account_id: nubank.id,
        destination_account_id: "e1",
        destination_account_name: "Supermercado",
        category_id: "c1",
        tag_ids: ["t1"],
        notes: "nota",
      },
    ]);
    const loaded = formFromTransaction(t, ctx);
    expect(loaded.ok && loaded.state).toMatchObject({
      kind: "withdrawal",
      accountId: nubank.id,
      counterpartyName: "Supermercado",
      ownCounterparty: false,
      amount: "1234,50",
      categoryId: "c1",
      tagIds: ["t1"],
      notes: "nota",
    });
    expect(roundTrip(t).splits[0]).toMatchObject({
      type: "withdrawal",
      amount: "1234.50",
      counterparty_name: "Supermercado",
      category_id: "c1",
      tag_ids: ["t1"],
      notes: "nota",
    });
  });

  it("entrada: a conta e o destino e a contraparte e a origem", () => {
    const t = makeTransaction({}, [deposit({ destination_account_id: nubank.id, source_account_name: "Empregador" })]);
    const loaded = formFromTransaction(t, ctx);
    expect(loaded.ok && loaded.state).toMatchObject({ kind: "deposit", accountId: nubank.id, counterpartyName: "Empregador" });
    expect(roundTrip(t).splits[0]).toMatchObject({ type: "deposit", account_id: nubank.id, counterparty_name: "Empregador" });
  });

  it("transferencia entre contas na mesma moeda", () => {
    const t = makeTransaction({}, [transfer({ source_account_id: nubank.id, destination_account_id: poupanca.id })]);
    expect(roundTrip(t).splits[0]).toMatchObject({
      type: "transfer",
      account_id: nubank.id,
      counterparty_account_id: poupanca.id,
    });
  });

  it("transferencia entre moedas reabre com o valor que chega", () => {
    const t = makeTransaction({}, [
      transfer({
        source_account_id: nubank.id,
        destination_account_id: wise.id,
        amount: "500.00",
        foreign_amount: "92.50",
        foreign_currency_code: "USD",
      }),
    ]);
    const loaded = formFromTransaction(t, ctx);
    expect(loaded.ok && loaded.state.foreignAmount).toBe("92,50");
    expect(roundTrip(t).splits[0]).toMatchObject({ amount: "500.00", foreign_amount: "92.50", foreign_currency_code: "USD" });
  });

  it("pagamento de divida reabre com a divida escolhida", () => {
    const t = makeTransaction({}, [
      {
        source_account_id: nubank.id,
        destination_account_id: divida.id,
        destination_account_name: "Financiamento",
        destination_account_type: "liability",
      },
    ]);
    const loaded = formFromTransaction(t, ctx);
    expect(loaded.ok && loaded.state).toMatchObject({ ownCounterparty: true, counterpartyAccountId: divida.id, counterpartyName: "" });
    expect(roundTrip(t).splits[0]).toMatchObject({ counterparty_account_id: divida.id });
  });

  it("lancamento dividido reabre em linhas, com o titulo e o total somado", () => {
    const t = makeTransaction({ title: "Compras da semana" }, [
      { description: "Frutas", amount: "60.00", category_id: "c1", notes: "boas", source_account_id: nubank.id, destination_account_id: "e1" },
      { description: "Limpeza", amount: "40.10", source_account_id: nubank.id, destination_account_id: "e1" },
    ]);
    const loaded = formFromTransaction(t, ctx);
    expect(loaded.ok && loaded.state).toMatchObject({ description: "Compras da semana", amount: "100,10" });
    expect(loaded.ok && loaded.state.splits?.map((row) => [row.description, row.amount, row.categoryId, row.notes])).toEqual([
      ["Frutas", "60,00", "c1", "boas"],
      ["Limpeza", "40,10", "", ""],
    ]);
    const payload = roundTrip(t);
    expect(payload.title).toBe("Compras da semana");
    expect(payload.splits.map((s) => s.amount)).toEqual(["60.00", "40.10"]);
    expect(payload.splits[0].notes).toBe("boas");
  });

  it("conta arquivada continua editavel", () => {
    const t = makeTransaction({}, [{ source_account_id: antiga.id, destination_account_id: "e1" }]);
    const loaded = formFromTransaction(t, ctx);
    expect(loaded.ok && loaded.state.accountId).toBe(antiga.id);
  });

  it.each([
    [
      "tipos diferentes",
      makeTransaction({}, []),
      [makeSplit({ source_account_id: nubank.id }), deposit({ destination_account_id: nubank.id })],
    ],
    ["datas diferentes", makeTransaction({}, []), [makeSplit({ date: "2026-03-01" }), makeSplit({ date: "2026-03-02" })]],
    [
      "contas diferentes",
      makeTransaction({}, []),
      [makeSplit({ source_account_id: nubank.id }), makeSplit({ source_account_id: poupanca.id })],
    ],
  ])("recusa editar quando as linhas tem %s", (_label, transaction, splits) => {
    transaction.splits = splits;
    const loaded = formFromTransaction(transaction, ctx);
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.reason).toContain("só pode ser editado pela API");
  });

  it("recusa editar quando ha valor original em outra moeda (informativo)", () => {
    const t = makeTransaction({}, [
      { source_account_id: nubank.id, destination_account_id: "e1", foreign_amount: "10.00", foreign_currency_code: "USD" },
    ]);
    const loaded = formFromTransaction(t, ctx);
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.reason).toContain("valor original");
  });

  it("recusa editar tipo que nao e saida, entrada ou transferencia", () => {
    const t = makeTransaction({}, [{ type: "opening_balance" }]);
    expect(formFromTransaction(t, ctx).ok).toBe(false);
  });

  it("recusa editar um grupo sem linhas", () => {
    expect(formFromTransaction(makeTransaction({ splits: [] }), ctx).ok).toBe(false);
  });
});

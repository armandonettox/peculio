import { describe, expect, it } from "vitest";

import { makeAccount } from "@/test-utils/accounts-api";
import { deposit, makeSplit, makeTransaction, transfer } from "@/test-utils/transaction-fixtures";
import { emptyForm, type FormContext } from "./form-model";
import {
  amountWithoutSign,
  buildQuickPayload,
  emptyQuickRow,
  firstErrorColumn,
  formFromQuick,
  isBlankRow,
  kindHint,
  kindOfAmount,
  QUICK_COLUMNS,
  quickFromTransaction,
  rowAfterAdd,
  rowChanged,
  validateQuick,
  type QuickRow,
} from "./quick-row";

const nubank = makeAccount({ id: "a1", name: "Nubank", currency_code: "BRL" });
const poupanca = makeAccount({ id: "a2", name: "Poupanca", currency_code: "BRL" });
const divida = makeAccount({ id: "a4", name: "Financiamento", type: "liability", role: "loan", currency_code: "BRL" });
const ctx: FormContext = { accounts: [nubank, poupanca, divida], places: { BRL: 2 } };

const row = (overrides: Partial<QuickRow> = {}): QuickRow => ({
  date: "2026-03-10",
  description: "Mercado",
  counterpartyName: "Supermercado",
  accountId: "a1",
  categoryId: "",
  amount: "-50,00",
  ...overrides,
});

const base = emptyForm(ctx);

describe("o sinal do valor", () => {
  it.each([
    ["-50,00", "withdrawal"],
    ["- 50", "withdrawal"],
    ["  -1.234,50", "withdrawal"],
    ["50,00", "deposit"],
    ["+50,00", "deposit"],
    ["", "deposit"],
  ])("%j e %s", (text, kind) => expect(kindOfAmount(text)).toBe(kind));

  it.each([
    ["-50,00", "50,00"],
    ["+ 50,00", "50,00"],
    ["50,00", "50,00"],
    ["-", ""],
    ["", ""],
  ])("sem sinal: %j vira %j", (text, expected) => expect(amountWithoutSign(text)).toBe(expected));

  it.each([
    ["-50", "Saída"],
    ["50", "Entrada"],
    ["+50", "Entrada"],
    ["", null],
    ["-", null],
    ["   ", null],
  ])("aviso de %j", (text, hint) => expect(kindHint(text)).toBe(hint));
});

describe("linha em branco", () => {
  it("data e conta ja preenchidas nao contam", () => {
    expect(isBlankRow(emptyQuickRow(ctx))).toBe(true);
  });

  it.each([
    ["descricao", { description: "x" }],
    ["contraparte", { counterpartyName: "x" }],
    ["valor", { amount: "1" }],
    ["categoria", { categoryId: "c1" }],
  ])("%s deixa de ser branca", (_name, overrides) => {
    expect(isBlankRow(emptyQuickRow(ctx, overrides))).toBe(false);
  });

  it("so espacos continua branca", () => {
    expect(isBlankRow(emptyQuickRow(ctx, { description: "  ", amount: " " }))).toBe(true);
  });
});

describe("proxima linha depois de adicionar", () => {
  it("guarda data e conta e limpa o resto", () => {
    const next = rowAfterAdd(row({ date: "2026-02-01", accountId: "a2", categoryId: "c1" }), ctx);
    expect(next).toEqual({ date: "2026-02-01", description: "", counterpartyName: "", accountId: "a2", categoryId: "", amount: "" });
  });
});

describe("formFromQuick", () => {
  it("saida: tipo, valor sem sinal e as seis colunas", () => {
    const state = formFromQuick(row({ categoryId: "c1" }), base);
    expect(state).toMatchObject({
      kind: "withdrawal",
      date: "2026-03-10",
      description: "Mercado",
      counterpartyName: "Supermercado",
      accountId: "a1",
      categoryId: "c1",
      amount: "50,00",
    });
  });

  it("entrada pelo valor positivo", () => {
    expect(formFromQuick(row({ amount: "1.000,00" }), base).kind).toBe("deposit");
  });

  it("o que nao e coluna vem do base", () => {
    const withExtras = { ...base, tagIds: ["t1"], notes: "nota", budgetId: "b1" };
    const state = formFromQuick(row(), withExtras);
    expect(state.tagIds).toEqual(["t1"]);
    expect(state.notes).toBe("nota");
    expect(state.budgetId).toBe("b1");
  });

  it("mudar de saida para entrada solta a conta a pagar", () => {
    const withBill = { ...base, kind: "withdrawal" as const, billId: "bill-1" };
    expect(formFromQuick(row({ amount: "50" }), withBill).billId).toBe("");
  });

  it("mantendo a saida, a conta a pagar continua", () => {
    const withBill = { ...base, kind: "withdrawal" as const, billId: "bill-1" };
    expect(formFromQuick(row(), withBill).billId).toBe("bill-1");
  });
});

describe("validateQuick", () => {
  it("linha completa nao tem erro", () => {
    expect(validateQuick(row(), base, ctx)).toEqual({});
  });

  it("cada coluna obrigatoria", () => {
    const errors = validateQuick(row({ description: " ", counterpartyName: "", accountId: "", amount: "", date: "" }), base, ctx);
    expect(Object.keys(errors).sort()).toEqual(["account", "amount", "counterparty", "date", "description"]);
  });

  it("mensagem da contraparte segue o tipo", () => {
    expect(validateQuick(row({ counterpartyName: "" }), base, ctx).counterparty).toBe("Informe para quem foi.");
    expect(validateQuick(row({ counterpartyName: "", amount: "50" }), base, ctx).counterparty).toBe("Informe de quem veio.");
  });

  it("sem valor ainda, a mensagem da contraparte e neutra", () => {
    expect(validateQuick(row({ counterpartyName: "", amount: "" }), base, ctx).counterparty).toBe("Informe a contraparte.");
    expect(validateQuick(row({ counterpartyName: "", amount: "-" }), base, ctx).counterparty).toBe("Informe a contraparte.");
  });

  it("valor zero ou so o sinal nao passa", () => {
    expect(validateQuick(row({ amount: "0" }), base, ctx).amount).toBe("Informe o valor maior que zero.");
    expect(validateQuick(row({ amount: "-" }), base, ctx).amount).toBe("Informe o valor.");
  });

  it("casas decimais a mais que a moeda", () => {
    expect(validateQuick(row({ amount: "-1,234" }), base, ctx).amount).toBe("Use no máximo 2 casas decimais.");
  });

  it("data fora do formato", () => {
    expect(validateQuick(row({ date: "10/03/2026" }), base, ctx).date).toBe("Informe uma data válida.");
  });
});

describe("firstErrorColumn", () => {
  it("segue a ordem do Tab", () => {
    expect(firstErrorColumn({ amount: "x", description: "y" })).toBe("description");
    expect(firstErrorColumn({ account: "x", amount: "y" })).toBe("account");
    expect(firstErrorColumn({ counterparty: "x", date: "y" })).toBe("date");
  });

  it("sem erro, nenhuma", () => {
    expect(firstErrorColumn({})).toBeNull();
  });

  it("as colunas sao as seis, em ordem", () => {
    expect(QUICK_COLUMNS).toEqual(["date", "description", "counterparty", "account", "category", "amount"]);
  });
});

describe("buildQuickPayload", () => {
  it("saida para um nome", () => {
    expect(buildQuickPayload(row({ categoryId: "c1" }), base, ctx)).toEqual({
      splits: [
        {
          type: "withdrawal",
          date: "2026-03-10",
          currency_code: "BRL",
          account_id: "a1",
          counterparty_name: "Supermercado",
          description: "Mercado",
          amount: "50.00",
          category_id: "c1",
          budget_id: null,
          tag_ids: [],
          notes: null,
        },
      ],
    });
  });

  it("entrada nao leva orcamento nem conta a pagar", () => {
    const payload = buildQuickPayload(row({ amount: "1.000,00" }), { ...base, budgetId: "b1", billId: "bill-1" }, ctx);
    expect(payload.splits[0]).toMatchObject({ type: "deposit", amount: "1000.00", budget_id: null });
    expect(payload.splits[0]).not.toHaveProperty("bill_id");
  });

  it("espacos nas pontas da descricao e da contraparte saem", () => {
    const payload = buildQuickPayload(row({ description: "  Mercado ", counterpartyName: " Loja  " }), base, ctx);
    expect(payload.splits[0]).toMatchObject({ description: "Mercado", counterparty_name: "Loja" });
  });
});

describe("quickFromTransaction", () => {
  it("saida vira valor com menos", () => {
    const loaded = quickFromTransaction(makeTransaction({}, [{ source_account_id: "a1", amount: "50.00", category_id: "c1" }]), ctx);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.row).toMatchObject({ date: "2026-03-10", accountId: "a1", categoryId: "c1", amount: "-50,00" });
      expect(loaded.base.kind).toBe("withdrawal");
    }
  });

  it("entrada fica sem sinal", () => {
    const loaded = quickFromTransaction(makeTransaction({}, [deposit({ destination_account_id: "a1", amount: "200.00" })]), ctx);
    expect(loaded.ok && loaded.row.amount).toBe("200,00");
  });

  it("o que as colunas nao mostram fica no base", () => {
    const loaded = quickFromTransaction(
      makeTransaction({}, [{ source_account_id: "a1", tag_ids: ["t1"], notes: "nota", budget_id: "b1" }]),
      ctx,
    );
    expect(loaded.ok && loaded.base).toMatchObject({ tagIds: ["t1"], notes: "nota", budgetId: "b1" });
  });

  it("salvar sem mexer devolve o mesmo lancamento (tags, nota e orcamento preservados)", () => {
    const loaded = quickFromTransaction(
      makeTransaction({}, [{ source_account_id: "a1", tag_ids: ["t1"], notes: "nota", budget_id: "b1", bill_id: null }]),
      ctx,
    );
    if (!loaded.ok) throw new Error("deveria abrir");
    expect(buildQuickPayload(loaded.row, loaded.base, ctx).splits[0]).toMatchObject({
      type: "withdrawal",
      amount: "50.00",
      tag_ids: ["t1"],
      notes: "nota",
      budget_id: "b1",
    });
  });

  it.each([
    ["dividido", makeTransaction({}, [{ source_account_id: "a1" }, { source_account_id: "a1", description: "outra" }]), /dividido/],
    ["transferencia", makeTransaction({}, [transfer({ source_account_id: "a1", destination_account_id: "a2" })]), /Transfer/],
    [
      "ligado a divida",
      makeTransaction({}, [makeSplit({ source_account_id: "a1", destination_account_id: "a4", destination_account_type: "liability" })]),
      /dívida/,
    ],
  ])("%s so no formulario completo", (_name, transaction, reason) => {
    const loaded = quickFromTransaction(transaction, ctx);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.reason).toMatch(reason);
  });
});

describe("rowChanged", () => {
  it("igual nao mudou", () => expect(rowChanged(row(), row())).toBe(false));
  it.each(Object.keys(row()) as (keyof QuickRow)[])("mudar %s conta como mudanca", (key) => {
    expect(rowChanged({ ...row(), [key]: "outro" }, row())).toBe(true);
  });
});

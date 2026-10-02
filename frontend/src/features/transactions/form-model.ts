import type { Account } from "@/api/accounts";
import type { Transaction, TransactionCreate, TransactionSplitCreate } from "@/api/transactions";
import { todayLocal } from "@/lib/dates";
import { formatMoney, negateMoney, parseMoneyInput, placesOf, sumMoney } from "@/lib/money";

// Regras do formulario de lancamento, sem tela: validar, montar o que vai para a API e reabrir
// um lancamento existente para editar. Ficam aqui, com testes, e a tela so as usa.

export type Kind = "withdrawal" | "deposit" | "transfer";

export type SplitDraft = {
  // Identifica a linha na tela enquanto o usuario adiciona e remove
  key: string;
  description: string;
  amount: string;
  categoryId: string;
  // Orcamento da linha ("" = nenhum). So existe em saida para uma despesa.
  budgetId: string;
  // Conta a pagar da linha: "" = automatico, "none" = nao ligar, ou o id de uma conta a pagar
  billId: string;
  tagIds: string[];
  // Nao aparece na tela; guarda a nota de um lancamento criado pela API para nao perde-la ao salvar
  notes: string;
};

export type FormState = {
  kind: Kind;
  date: string;
  // Descricao do lancamento; no modo dividido vira o titulo do grupo
  description: string;
  accountId: string;
  // Saida e entrada: um nome (despesa ou receita) ou uma conta propria (divida)
  counterpartyName: string;
  ownCounterparty: boolean;
  // Transferencia: a conta de destino. Saida e entrada com divida: a divida.
  counterpartyAccountId: string;
  amount: string;
  // Valor que chega na outra conta quando as moedas sao diferentes
  foreignAmount: string;
  categoryId: string;
  // Orcamento do lancamento ("" = nenhum); no modo dividido cada linha tem o seu
  budgetId: string;
  // Conta a pagar: "" = o servidor liga sozinho se uma so combinar, "none" = nao ligar, ou o id de uma
  billId: string;
  tagIds: string[];
  notes: string;
  // null: um lancamento so. Lista: o lancamento dividido em linhas.
  splits: SplitDraft[] | null;
};

export type FormContext = {
  accounts: Account[];
  // Casas decimais por moeda, vindas da API
  places: Record<string, number>;
};

export type FormErrors = {
  description?: string;
  date?: string;
  accountId?: string;
  counterparty?: string;
  amount?: string;
  foreignAmount?: string;
  splitTotal?: string;
  splits?: Record<string, { description?: string; amount?: string }>;
};

let keyCounter = 0;
export const newSplitKey = () => `split-${++keyCounter}`;

export function emptySplit(overrides: Partial<SplitDraft> = {}): SplitDraft {
  return {
    key: newSplitKey(),
    description: "",
    amount: "",
    categoryId: "",
    budgetId: "",
    billId: "",
    tagIds: [],
    notes: "",
    ...overrides,
  };
}

export const accountOf = (ctx: FormContext, id: string) => ctx.accounts.find((account) => account.id === id);

export const isLiability = (account: Account | undefined) => account?.type === "liability";

/** A conta mais provavel para comecar: a primeira conta ativa que nao e divida. */
export function defaultAccountId(accounts: Account[]): string {
  const active = accounts.filter((account) => account.active);
  return (active.find((account) => account.type === "asset") ?? active[0])?.id ?? "";
}

export function emptyForm(ctx: FormContext, overrides: Partial<FormState> = {}): FormState {
  return {
    kind: "withdrawal",
    date: todayLocal(),
    description: "",
    accountId: defaultAccountId(ctx.accounts),
    counterpartyName: "",
    ownCounterparty: false,
    counterpartyAccountId: "",
    amount: "",
    foreignAmount: "",
    categoryId: "",
    budgetId: "",
    billId: "",
    tagIds: [],
    notes: "",
    splits: null,
    ...overrides,
  };
}

// ---------- Moeda ----------

/**
 * A conta da outra ponta quando as moedas sao diferentes e o valor que chega precisa ser
 * informado (transferencia, ou pagamento de uma divida em outra moeda). null nos demais casos.
 */
export function foreignAccount(state: FormState, ctx: FormContext): Account | null {
  const usesAccount = state.kind === "transfer" || (state.kind === "withdrawal" && state.ownCounterparty);
  if (!usesAccount) return null;
  const source = accountOf(ctx, state.accountId);
  const other = accountOf(ctx, state.counterpartyAccountId);
  if (!source || !other || source.currency_code === other.currency_code) return null;
  return other;
}

/** Orcamento so vale para gasto: saida para um nome (despesa), nunca entrada, transferencia ou divida. */
export function budgetAllowed(state: FormState): boolean {
  return state.kind === "withdrawal" && !state.ownCounterparty;
}

/** Campo bill_id do corpo: omitido no automatico, null em "nao ligar", ou o id. So vale onde ha orcamento. */
function billField(state: FormState, value: string): { bill_id?: string | null } {
  if (!budgetAllowed(state) || value === "") return {};
  return { bill_id: value === "none" ? null : value };
}

/** Dividir so faz sentido em saida e entrada na mesma moeda. */
export function canSplit(state: FormState, ctx: FormContext): boolean {
  return state.kind !== "transfer" && foreignAccount(state, ctx) === null;
}

function currencyOf(state: FormState, ctx: FormContext): string {
  return accountOf(ctx, state.accountId)?.currency_code ?? "BRL";
}

const isPositive = (value: string) => !/^-?0+(\.0+)?$/.test(value) && !value.startsWith("-");

type Parsed = { value: string } | { error: string };

function parsePositive(text: string, places: number, label = "o valor"): Parsed {
  const parsed = parseMoneyInput(text, places);
  if (!parsed.ok) return { error: parsed.error };
  if (!isPositive(parsed.value)) return { error: `Informe ${label} maior que zero.` };
  return { value: parsed.value };
}

/** Quanto falta distribuir entre as linhas: positivo falta, negativo passou, null se nao da para calcular. */
export function remainder(state: FormState, ctx: FormContext): string | null {
  if (!state.splits) return null;
  const places = placesOf(currencyOf(state, ctx), ctx.places);
  const total = parsePositive(state.amount, places);
  if ("error" in total) return null;
  const values: string[] = [];
  for (const row of state.splits) {
    if (row.amount.trim() === "") continue;
    const parsed = parsePositive(row.amount, places);
    if ("error" in parsed) return null;
    values.push(parsed.value);
  }
  const distributed = sumMoney(values, places);
  return sumMoney([total.value, negateMoney(distributed)], places);
}

export function formatRemainder(value: string, currency: string): string {
  return formatMoney(value.startsWith("-") ? value.slice(1) : value, currency);
}

// ---------- Validacao ----------

export function validateForm(state: FormState, ctx: FormContext): FormErrors {
  const errors: FormErrors = {};
  const source = accountOf(ctx, state.accountId);
  const currency = currencyOf(state, ctx);
  const places = placesOf(currency, ctx.places);

  if (!state.date || !/^\d{4}-\d{2}-\d{2}$/.test(state.date)) errors.date = "Informe uma data válida.";
  if (!state.accountId || !source) errors.accountId = "Escolha a conta.";

  // Sem divisao a descricao e obrigatoria; com divisao ela e o titulo e cada linha tem a sua
  if (!state.splits && state.description.trim() === "") errors.description = "Informe a descrição.";

  // A outra ponta
  if (state.kind === "transfer") {
    if (!state.counterpartyAccountId) errors.counterparty = "Escolha a conta de destino.";
    else if (state.counterpartyAccountId === state.accountId) {
      errors.counterparty = "A conta de destino precisa ser diferente da conta de origem.";
    }
  } else if (state.ownCounterparty) {
    if (!state.counterpartyAccountId) errors.counterparty = "Escolha a dívida.";
    else if (state.kind === "deposit") {
      const debt = accountOf(ctx, state.counterpartyAccountId);
      if (debt && source && debt.currency_code !== source.currency_code) {
        errors.counterparty = "Para receber de uma dívida, as duas contas precisam ter a mesma moeda.";
      }
    }
  } else if (state.counterpartyName.trim() === "") {
    errors.counterparty = state.kind === "withdrawal" ? "Informe para quem foi." : "Informe de quem veio.";
  }

  // Valor
  const total = parsePositive(state.amount, places);
  if ("error" in total) errors.amount = total.error;

  const other = foreignAccount(state, ctx);
  if (other) {
    const foreign = parsePositive(state.foreignAmount, placesOf(other.currency_code, ctx.places), "o valor");
    if ("error" in foreign) errors.foreignAmount = foreign.error;
  }

  // Divisao: cada linha precisa de descricao e valor, e a soma precisa fechar o total
  if (state.splits) {
    const rowErrors: NonNullable<FormErrors["splits"]> = {};
    for (const row of state.splits) {
      const rowError: { description?: string; amount?: string } = {};
      if (row.description.trim() === "") rowError.description = "Informe a descrição.";
      const parsed = parsePositive(row.amount, places);
      if ("error" in parsed) rowError.amount = parsed.error;
      if (rowError.description || rowError.amount) rowErrors[row.key] = rowError;
    }
    if (Object.keys(rowErrors).length > 0) errors.splits = rowErrors;

    if (!errors.amount && !errors.splits) {
      const left = remainder(state, ctx);
      if (left !== null && !/^0+(\.0+)?$/.test(left)) {
        errors.splitTotal =
          (left.startsWith("-") ? "As linhas passam do total em " : "Falta distribuir ") + formatRemainder(left, currency);
      }
    }
  }
  return errors;
}

export const hasErrors = (errors: FormErrors) => Object.keys(errors).length > 0;

// ---------- O que vai para a API ----------

/** Monta o corpo do pedido. Chame so depois de validateForm devolver sem erros. */
export function buildPayload(state: FormState, ctx: FormContext): TransactionCreate {
  const account = accountOf(ctx, state.accountId);
  if (!account) throw new Error("Conta nao encontrada no formulario");
  const places = placesOf(account.currency_code, ctx.places);
  const other = foreignAccount(state, ctx);

  const money = (text: string, decimals = places): string => {
    const parsed = parseMoneyInput(text, decimals);
    if (!parsed.ok) throw new Error(`Valor invalido no formulario: ${text}`);
    return parsed.value;
  };

  const common = {
    type: state.kind,
    date: state.date,
    currency_code: account.currency_code,
    account_id: account.id,
    // Nome novo ou conta existente, nunca os dois
    ...(state.kind === "transfer" || state.ownCounterparty
      ? { counterparty_account_id: state.counterpartyAccountId }
      : { counterparty_name: state.counterpartyName.trim() }),
  };

  if (!state.splits) {
    const split: TransactionSplitCreate = {
      ...common,
      description: state.description.trim(),
      amount: money(state.amount),
      category_id: state.categoryId || null,
      budget_id: budgetAllowed(state) ? state.budgetId || null : null,
      ...billField(state, state.billId),
      tag_ids: state.tagIds,
      notes: state.notes.trim() || null,
      ...(other
        ? {
            foreign_amount: money(state.foreignAmount, placesOf(other.currency_code, ctx.places)),
            foreign_currency_code: other.currency_code,
          }
        : {}),
    };
    return { splits: [split] };
  }

  return {
    title: state.description.trim() || null,
    splits: state.splits.map((row) => ({
      ...common,
      description: row.description.trim(),
      amount: money(row.amount),
      category_id: row.categoryId || null,
      budget_id: budgetAllowed(state) ? row.budgetId || null : null,
      ...billField(state, row.billId),
      tag_ids: row.tagIds,
      notes: row.notes.trim() || null,
    })),
  };
}

// ---------- Reabrir um lancamento para editar ----------

export type Loaded = { ok: true; state: FormState } | { ok: false; reason: string };

const KINDS: Kind[] = ["withdrawal", "deposit", "transfer"];
const toDraft = (value: string) => value.replace(".", ",");

// Ao editar, o que ja esta salvo vale: sem conta a pagar vira "nao ligar", para um ajuste qualquer nao
// religar sozinho o que a pessoa deixou solto. Fora de saida para um nome o campo nem existe.
function billOf(billId: string | null, kind: Kind, ownCounterparty: boolean): string {
  if (kind !== "withdrawal" || ownCounterparty) return "";
  return billId ?? "none";
}

/**
 * Transforma um lancamento ja salvo em estado de formulario. Lancamentos criados pela API
 * podem ter formas que o formulario nao representa (divisoes de tipos, datas ou contas
 * diferentes); nesse caso devolve o motivo, em vez de editar errado e perder dado.
 */
export function formFromTransaction(transaction: Transaction, ctx: FormContext): Loaded {
  const [first] = transaction.splits;
  if (!first) return { ok: false, reason: "Este lançamento não tem linhas." };
  if (!KINDS.includes(first.type as Kind)) {
    return { ok: false, reason: "Este tipo de lançamento não pode ser editado por aqui." };
  }
  const kind = first.type as Kind;

  const uniform = transaction.splits.every(
    (split) =>
      split.type === kind &&
      split.date === first.date &&
      split.source_account_id === first.source_account_id &&
      split.destination_account_id === first.destination_account_id &&
      split.currency_code === first.currency_code,
  );
  if (!uniform) {
    return {
      ok: false,
      reason: "As linhas deste lançamento têm tipos, datas ou contas diferentes. Ele só pode ser editado pela API.",
    };
  }

  const accountId = kind === "deposit" ? first.destination_account_id : first.source_account_id;
  const otherId = kind === "deposit" ? first.source_account_id : first.destination_account_id;
  const otherType = kind === "deposit" ? first.source_account_type : first.destination_account_type;
  const otherName = kind === "deposit" ? first.source_account_name : first.destination_account_name;
  const ownCounterparty = kind !== "transfer" && (otherType === "asset" || otherType === "liability");

  const base = emptyForm(ctx, {
    kind,
    date: first.date,
    accountId,
    ownCounterparty,
    counterpartyName: kind !== "transfer" && !ownCounterparty ? otherName : "",
    counterpartyAccountId: kind === "transfer" || ownCounterparty ? otherId : "",
  });

  const needsForeign = foreignAccount(base, ctx) !== null;
  // Valor em outra moeda so informativo (compra em dolar paga em real): o formulario ainda nao o edita
  const hasInformativeForeign = transaction.splits.some((split) => split.foreign_amount && !needsForeign);
  if (hasInformativeForeign) {
    return {
      ok: false,
      reason: "Este lançamento guarda o valor original em outra moeda, que o formulário ainda não edita.",
    };
  }
  const foreignAmount = needsForeign && first.foreign_amount ? toDraft(first.foreign_amount) : "";

  if (transaction.splits.length === 1) {
    return {
      ok: true,
      state: {
        ...base,
        description: first.description,
        amount: toDraft(first.amount),
        foreignAmount,
        categoryId: first.category_id ?? "",
        budgetId: first.budget_id ?? "",
        billId: billOf(first.bill_id, kind, ownCounterparty),
        tagIds: first.tag_ids,
        notes: first.notes ?? "",
        splits: null,
      },
    };
  }

  const places = placesOf(first.currency_code, ctx.places);
  return {
    ok: true,
    state: {
      ...base,
      description: transaction.title ?? "",
      amount: toDraft(
        sumMoney(
          transaction.splits.map((split) => split.amount),
          places,
        ),
      ),
      splits: transaction.splits.map((split) =>
        emptySplit({
          description: split.description,
          amount: toDraft(split.amount),
          categoryId: split.category_id ?? "",
          budgetId: split.budget_id ?? "",
          billId: billOf(split.bill_id, kind, ownCounterparty),
          tagIds: split.tag_ids,
          notes: split.notes ?? "",
        }),
      ),
    },
  };
}

import { i18n } from "@/i18n";
import type { Transaction, TransactionCreate } from "@/api/transactions";
import {
  buildPayload,
  defaultAccountId,
  emptyForm,
  formFromTransaction,
  hasErrors,
  validateForm,
  type FormContext,
  type FormState,
} from "./form-model";

// A linha da tabela rapida, sem tela. Tem so as seis colunas do dia a dia; o resto do lancamento (tags, orcamento, conta
// a pagar, notas, outra moeda) fica no `base`, que e o estado do formulario completo, e passa pelas mesmas regras do
// dialogo: a linha vira um FormState e usa validateForm e buildPayload, entao nada de regra e repetido aqui.

export type QuickColumn = "date" | "description" | "counterparty" | "account" | "category" | "amount";

// A ordem em que o Tab anda pela linha
export const QUICK_COLUMNS: QuickColumn[] = ["date", "description", "counterparty", "account", "category", "amount"];

export type QuickRow = {
  date: string;
  description: string;
  counterpartyName: string;
  accountId: string;
  categoryId: string;
  // Como a pessoa digitou: o sinal diz o tipo ("-50,00" e saida, "50,00" e entrada)
  amount: string;
};

export type QuickErrors = Partial<Record<"date" | "description" | "counterparty" | "account" | "amount", string>>;

export type QuickKind = "withdrawal" | "deposit";

export function emptyQuickRow(ctx: FormContext, overrides: Partial<QuickRow> = {}): QuickRow {
  return {
    date: emptyForm(ctx).date,
    description: "",
    counterpartyName: "",
    accountId: defaultAccountId(ctx.accounts),
    categoryId: "",
    amount: "",
    ...overrides,
  };
}

/** A proxima linha de entrada depois de adicionar uma: lancar varias seguidas costuma ser na mesma data e conta. */
export function rowAfterAdd(row: QuickRow, ctx: FormContext): QuickRow {
  return emptyQuickRow(ctx, { date: row.date, accountId: row.accountId });
}

/** Linha em que a pessoa ainda nao digitou nada (data e conta ja vem preenchidas, nao contam). */
export function isBlankRow(row: QuickRow): boolean {
  return row.description.trim() === "" && row.counterpartyName.trim() === "" && row.amount.trim() === "" && row.categoryId === "";
}

// ---------- O sinal do valor ----------

const SIGN = /^\s*([+-])?\s*/;

/** Menos na frente e saida; sem sinal ou com mais, entrada. */
export function kindOfAmount(text: string): QuickKind {
  return SIGN.exec(text)?.[1] === "-" ? "withdrawal" : "deposit";
}

/** O valor sem o sinal, pronto para validar como numero positivo. */
export function amountWithoutSign(text: string): string {
  return text.replace(SIGN, "").trim();
}

/** O que a pessoa esta lancando, em palavras, enquanto digita o valor. null com o campo vazio. */
export function kindHint(text: string): string | null {
  if (amountWithoutSign(text) === "") return null;
  return i18n.t(kindOfAmount(text) === "withdrawal" ? "transactions.quickRow.expense" : "transactions.quickRow.income");
}

// ---------- Linha -> formulario ----------

/** O estado do formulario completo para a linha: o `base` com as seis colunas por cima. */
export function formFromQuick(row: QuickRow, base: FormState): FormState {
  const kind = kindOfAmount(row.amount);
  const next: FormState = {
    ...base,
    kind,
    date: row.date,
    description: row.description,
    counterpartyName: row.counterpartyName,
    accountId: row.accountId,
    categoryId: row.categoryId,
    amount: amountWithoutSign(row.amount),
  };
  // Conta a pagar so vale em saida: se o tipo mudou, o que estava ligado deixa de fazer sentido
  if (kind !== base.kind) next.billId = "";
  return next;
}

export function validateQuick(row: QuickRow, base: FormState, ctx: FormContext): QuickErrors {
  const found = validateForm(formFromQuick(row, base), ctx);
  const errors: QuickErrors = {};
  if (found.date) errors.date = found.date;
  if (found.description) errors.description = found.description;
  // Sem valor ainda o tipo nao esta definido: a mensagem de "para quem foi" ou "de quem veio" confundiria
  if (found.counterparty) {
    errors.counterparty = amountWithoutSign(row.amount) === "" ? i18n.t("transactions.quickRow.counterpartyRequired") : found.counterparty;
  }
  if (found.accountId) errors.account = found.accountId;
  if (found.amount) errors.amount = found.amount;
  return errors;
}

/** Monta o corpo do pedido. Chame so depois de validateQuick devolver sem erros. */
export function buildQuickPayload(row: QuickRow, base: FormState, ctx: FormContext): TransactionCreate {
  return buildPayload(formFromQuick(row, base), ctx);
}

export const hasQuickErrors = (errors: QuickErrors) => hasErrors(errors);

/** A primeira coluna com erro, na ordem do Tab: e para la que o foco volta. */
export function firstErrorColumn(errors: QuickErrors): QuickColumn | null {
  return QUICK_COLUMNS.find((column) => Boolean(errors[column as keyof QuickErrors])) ?? null;
}

// ---------- Lancamento -> linha ----------

export type QuickLoaded = { ok: true; row: QuickRow; base: FormState } | { ok: false; reason: string };

/**
 * Abre um lancamento salvo como linha editavel. So cabe o que as seis colunas representam sem perder nada: um
 * lancamento so (sem divisao), saida ou entrada para um nome. O resto so se edita no dialogo completo.
 */
export function quickFromTransaction(transaction: Transaction, ctx: FormContext): QuickLoaded {
  const loaded = formFromTransaction(transaction, ctx);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const state = loaded.state;
  if (state.splits) return { ok: false, reason: i18n.t("transactions.quickRow.reasonSplit") };
  if (state.kind === "transfer") return { ok: false, reason: i18n.t("transactions.quickRow.reasonTransfer") };
  if (state.ownCounterparty) return { ok: false, reason: i18n.t("transactions.quickRow.reasonDebt") };
  return {
    ok: true,
    base: state,
    row: {
      date: state.date,
      description: state.description,
      counterpartyName: state.counterpartyName,
      accountId: state.accountId,
      categoryId: state.categoryId,
      amount: `${state.kind === "withdrawal" ? "-" : ""}${state.amount}`,
    },
  };
}

/** A linha mudou em relacao ao que estava salvo? Sem mudanca, Enter so desce e nao faz pedido ao servidor. */
export function rowChanged(row: QuickRow, original: QuickRow): boolean {
  return (Object.keys(row) as (keyof QuickRow)[]).some((key) => row[key] !== original[key]);
}

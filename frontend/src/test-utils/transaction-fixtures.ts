import type { Transaction, TransactionSplit } from "@/api/transactions";

let counter = 0;
const uuid = (prefix: string) => `${prefix}-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

export function makeSplit(overrides: Partial<TransactionSplit> = {}): TransactionSplit {
  return {
    id: uuid("30000000"),
    type: "withdrawal",
    date: "2026-03-10",
    description: "Compra no mercado",
    source_account_id: "a0000000-0000-4000-8000-000000000001",
    destination_account_id: "e0000000-0000-4000-8000-000000000001",
    source_account_name: "Nubank",
    source_account_type: "asset",
    destination_account_name: "Supermercado",
    destination_account_type: "expense",
    amount: "50.00",
    currency_code: "BRL",
    foreign_amount: null,
    foreign_currency_code: null,
    category_id: null,
    budget_id: null,
    bill_id: null,
    tag_ids: [],
    notes: null,
    cleared: false,
    locked: false,
    ...overrides,
  };
}

export function makeTransaction(overrides: Partial<Transaction> = {}, splits?: Partial<TransactionSplit>[]): Transaction {
  return {
    id: uuid("40000000"),
    title: null,
    recurrence_id: null,
    created_at: "2026-03-10T12:00:00Z",
    attachment_count: 0,
    splits: (splits ?? [{}]).map((split) => makeSplit(split)),
    ...overrides,
  };
}

export const deposit = (overrides: Partial<TransactionSplit> = {}) =>
  makeSplit({
    type: "deposit",
    description: "Salario",
    source_account_name: "Empregador",
    source_account_type: "revenue",
    destination_account_name: "Nubank",
    destination_account_type: "asset",
    amount: "3000.00",
    ...overrides,
  });

export const transfer = (overrides: Partial<TransactionSplit> = {}) =>
  makeSplit({
    type: "transfer",
    description: "Reserva",
    source_account_name: "Nubank",
    destination_account_name: "Poupanca",
    destination_account_type: "asset",
    amount: "100.00",
    ...overrides,
  });

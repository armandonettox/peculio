import type { Account } from "@/api/accounts";

type Role = NonNullable<Account["role"]>;
export type AccountKind = "asset" | "liability";

export const ROLE_LABELS: Record<Role, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
  other: "Outra",
  loan: "Empréstimo",
  debt: "Dívida",
  mortgage: "Financiamento",
};

// Papeis que cada tipo aceita (espelha o backend: ASSET_ROLES e LIABILITY_ROLES)
export const ROLES_BY_KIND: Record<AccountKind, Role[]> = {
  asset: ["checking", "savings", "cash", "credit_card", "other"],
  liability: ["loan", "debt", "mortgage"],
};

export const DEFAULT_ROLE: Record<AccountKind, Role> = { asset: "checking", liability: "debt" };

export const KIND_LABELS: Record<AccountKind, string> = { asset: "Conta", liability: "Dívida" };

import type { Account } from "@/api/accounts";
import { i18n } from "@/i18n";

type Role = NonNullable<Account["role"]>;
export type AccountKind = "asset" | "liability";

export const roleLabel = (role: Role): string => i18n.t(`accounts.role.${role}`);

// Papeis que cada tipo aceita (espelha o backend: ASSET_ROLES e LIABILITY_ROLES)
export const ROLES_BY_KIND: Record<AccountKind, Role[]> = {
  asset: ["checking", "savings", "cash", "credit_card", "other"],
  liability: ["loan", "debt", "mortgage"],
};

export const DEFAULT_ROLE: Record<AccountKind, Role> = { asset: "checking", liability: "debt" };

export const kindLabel = (kind: AccountKind): string => i18n.t(`accounts.kind.${kind}`);

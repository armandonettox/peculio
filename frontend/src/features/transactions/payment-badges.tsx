import { CircleAlert, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Transaction } from "@/api/transactions";
import { paymentState } from "./presentation";

/** Selos de "nao paga" e "ignorada", sempre com texto: a cor sozinha nao diz nada a quem nao a enxerga. */
export function PaymentBadges({ transaction }: { transaction: Transaction }) {
  const { t } = useTranslation();
  const state = paymentState(transaction);
  if (!state.unpaid && !state.ignored) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {state.unpaid && (
        <span className="inline-flex items-center gap-1 rounded-md border border-destructive px-1.5 py-0.5 font-medium text-destructive">
          <CircleAlert className="size-3" aria-hidden="true" />
          {state.income ? t("transactions.payment.unpaidIncome") : t("transactions.payment.unpaidExpense")}
        </span>
      )}
      {state.ignored && (
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
          <EyeOff className="size-3" aria-hidden="true" />
          {t("transactions.payment.ignored")}
        </span>
      )}
    </span>
  );
}

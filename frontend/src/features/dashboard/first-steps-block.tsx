import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAccounts } from "@/api/accounts";
import { useBudgets } from "@/api/budgets";
import { useTransactions } from "@/api/transactions";
import { cn } from "@/lib/utils";

/**
 * "Primeiros passos": checklist com barra de progresso para quem esta comecando. Some sozinho quando todos os
 * passos estao feitos; enquanto os dados carregam (ou falham) nao aparece, para nao piscar na tela de quem ja terminou.
 */
export function FirstStepsBlock() {
  const { t } = useTranslation();
  const accounts = useAccounts({ includeArchived: true });
  const budgets = useBudgets({ activeOnly: false });
  const transactions = useTransactions({});

  if (accounts.isPending || budgets.isPending || transactions.isPending) return null;
  if (accounts.isError || budgets.isError || transactions.isError) return null;

  const steps = [
    { key: "account", done: (accounts.data ?? []).some((account) => account.role !== "credit_card"), to: "/contas", label: t("dashboard.firstSteps.account") },
    { key: "card", done: (accounts.data ?? []).some((account) => account.role === "credit_card"), to: "/cartoes", label: t("dashboard.firstSteps.card") },
    { key: "transaction", done: (transactions.data?.pages[0]?.total ?? 0) > 0, to: "/transacoes", label: t("dashboard.firstSteps.transaction") },
    { key: "budget", done: (budgets.data ?? []).length > 0, to: "/orcamentos", label: t("dashboard.firstSteps.budget") },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  if (doneCount === steps.length) return null;
  const percent = Math.round((doneCount / steps.length) * 100);

  return (
    <section aria-labelledby="first-steps-title" className="min-w-0 rounded-lg border bg-card p-4">
      <h2 id="first-steps-title" className="text-base font-semibold text-primary-text">
        {t("dashboard.firstSteps.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("dashboard.firstSteps.subtitle")}</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="w-10 text-xs font-semibold tabular-nums">{percent}%</span>
        <div
          role="progressbar"
          aria-label={t("dashboard.firstSteps.title")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary-text" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2 text-sm">
            <span
              className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", step.done && "border-positive bg-positive text-white")}
              aria-hidden="true"
            >
              {step.done && <Check className="size-3" />}
            </span>
            {step.done ? (
              <span className="text-muted-foreground line-through">{step.label}</span>
            ) : (
              <Link to={step.to} className="font-medium hover:underline">
                {step.label}
              </Link>
            )}
            <span className="sr-only">{step.done ? t("dashboard.firstSteps.done") : t("dashboard.firstSteps.pending")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

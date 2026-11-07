import { Check, ChevronDown } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BudgetsSection } from "@/features/budgets/budgets-section";
import { MonthlyPlanSection } from "@/features/planning/monthly-plan-section";
import { monthKey } from "@/features/planning/presentation";
import { appToday } from "@/lib/dates";

type Mode = "monthly" | "custom";
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Orcamentos: o Planejamento Mensal (renda, economia e limite por categoria, mes a mes) e o Planejamento Personalizado
 * (limites com nome, que repetem por periodo). O tipo e o mes ficam na URL, entao voltar do assistente cai no mesmo lugar.
 */
export default function BudgetsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("modo") === "personalizado" ? "custom" : "monthly";
  const rawMonth = params.get("mes");
  const month = rawMonth && MONTH_PATTERN.test(rawMonth) ? rawMonth : monthKey(appToday());

  function update(changes: Record<string, string | null>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }

  const modes: { value: Mode; label: string }[] = [
    { value: "monthly", label: t("planning.mode.monthly") },
    { value: "custom", label: t("planning.mode.custom") },
  ];

  return (
    <>
      <PageHeader title={t("pages.budgets.orcamentos")} description={t("pages.budgets.quantoVoceJaUsou")} />
      <div className="mb-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={t("planning.mode.label")}>
              {modes.find((item) => item.value === mode)?.label}
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {modes.map((item) => (
              <DropdownMenuItem
                key={item.value}
                onSelect={() => update({ modo: item.value === "custom" ? "personalizado" : null })}
                className="gap-2"
              >
                <Check className={mode === item.value ? "size-4" : "size-4 opacity-0"} aria-hidden="true" />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {mode === "monthly" ? (
        <MonthlyPlanSection month={month} onMonthChange={(next) => update({ mes: next })} />
      ) : (
        <BudgetsSection />
      )}
    </>
  );
}

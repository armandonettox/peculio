import { X } from "lucide-react";

import type { Account } from "@/api/accounts";
import type { Budget } from "@/api/budgets";
import type { Category, Tag } from "@/api/labels";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PERIOD_KINDS, periodLabel, type PeriodKind, type ReportState } from "./period";
import { useTranslation } from "react-i18next";

type ReportFilterBarProps = {
  state: ReportState;
  activeCount: number;
  dateError?: string;
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  budgets: Budget[];
  onChange: (patch: Partial<ReportState>) => void;
  onClear: () => void;
};

export function ReportFilterBar({
  state,
  activeCount,
  dateError,
  accounts,
  categories,
  tags,
  budgets,
  onChange,
  onClear,
}: ReportFilterBarProps) {
  const { t } = useTranslation();
  return (
    <section aria-label={t("reports.reportFilterBar.filtrosDoRelatorio")} className="mb-6 grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id="report-period" label={t("common.periodo")}>
        {(field) => (
          <Select
            {...field}
            value={state.period}
            onChange={(event) => onChange({ period: event.target.value as PeriodKind })}
          >
            {PERIOD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {periodLabel(kind)}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {state.period === "custom" && (
        <>
          <FormField id="report-date-from" label={t("common.dataInicial")} error={dateError}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={state.dateFrom ?? ""}
                onChange={(event) => onChange({ dateFrom: event.target.value })}
              />
            )}
          </FormField>
          <FormField id="report-date-to" label={t("common.dataFinal")}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={state.dateTo ?? ""}
                onChange={(event) => onChange({ dateTo: event.target.value })}
              />
            )}
          </FormField>
        </>
      )}

      <FormField id="report-account" label={t("common.conta")}>
        {(field) => (
          <Select
            {...field}
            value={state.accountId ?? ""}
            onChange={(event) => onChange({ accountId: event.target.value })}
          >
            <option value="">{t("common.todas")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.active ? "" : ` ${t("reports.reportFilterBar.arquivada")}`}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="report-category" label={t("common.categoria")}>
        {(field) => (
          <Select
            {...field}
            value={state.categoryId ?? ""}
            onChange={(event) => onChange({ categoryId: event.target.value })}
          >
            <option value="">{t("common.todas")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="report-tag" label={t("common.tag")}>
        {(field) => (
          <Select {...field} value={state.tagId ?? ""} onChange={(event) => onChange({ tagId: event.target.value })}>
            <option value="">{t("common.todas")}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="report-budget" label={t("common.orcamento")}>
        {(field) => (
          <Select
            {...field}
            value={state.budgetId ?? ""}
            onChange={(event) => onChange({ budgetId: event.target.value })}
          >
            <option value="">{t("reports.reportFilterBar.todos")}</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
                {budget.active ? "" : ` ${t("reports.reportFilterBar.arquivado")}`}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {activeCount > 0 && (
        <div className="flex items-end">
          <Button type="button" variant="ghost" onClick={onClear}>
            <X />
            {t("common.limparFiltros")}
          </Button>
        </div>
      )}
    </section>
  );
}

import { X } from "lucide-react";

import type { Account } from "@/api/accounts";
import type { Budget } from "@/api/budgets";
import type { Category, Tag } from "@/api/labels";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PERIOD_KINDS, PERIOD_LABELS, type PeriodKind, type ReportState } from "./period";

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
  return (
    <section aria-label="Filtros do relatório" className="mb-6 grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id="report-period" label="Período">
        {(field) => (
          <Select
            {...field}
            value={state.period}
            onChange={(event) => onChange({ period: event.target.value as PeriodKind })}
          >
            {PERIOD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {PERIOD_LABELS[kind]}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {state.period === "custom" && (
        <>
          <FormField id="report-date-from" label="Data inicial" error={dateError}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={state.dateFrom ?? ""}
                onChange={(event) => onChange({ dateFrom: event.target.value })}
              />
            )}
          </FormField>
          <FormField id="report-date-to" label="Data final">
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

      <FormField id="report-account" label="Conta">
        {(field) => (
          <Select
            {...field}
            value={state.accountId ?? ""}
            onChange={(event) => onChange({ accountId: event.target.value })}
          >
            <option value="">Todas</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.active ? "" : " (arquivada)"}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="report-category" label="Categoria">
        {(field) => (
          <Select
            {...field}
            value={state.categoryId ?? ""}
            onChange={(event) => onChange({ categoryId: event.target.value })}
          >
            <option value="">Todas</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="report-tag" label="Tag">
        {(field) => (
          <Select {...field} value={state.tagId ?? ""} onChange={(event) => onChange({ tagId: event.target.value })}>
            <option value="">Todas</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="report-budget" label="Orçamento">
        {(field) => (
          <Select
            {...field}
            value={state.budgetId ?? ""}
            onChange={(event) => onChange({ budgetId: event.target.value })}
          >
            <option value="">Todos</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
                {budget.active ? "" : " (arquivado)"}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {activeCount > 0 && (
        <div className="flex items-end">
          <Button type="button" variant="ghost" onClick={onClear}>
            <X />
            Limpar filtros
          </Button>
        </div>
      )}
    </section>
  );
}

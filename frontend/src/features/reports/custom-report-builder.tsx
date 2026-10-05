import type { Account } from "@/api/accounts";
import type { Budget } from "@/api/budgets";
import type { Category, Tag } from "@/api/labels";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  allowedCharts,
  CHART_OPTIONS,
  GROUP_BY_OPTIONS,
  MEASURE_OPTIONS,
  normalize,
  PERIOD_OPTIONS,
  type CustomConfig,
} from "./custom-config";

type Props = {
  config: CustomConfig;
  onChange: (next: CustomConfig) => void;
  periodError?: string;
  // Filtros cujo item foi excluido (ex: "categoria")
  missing: string[];
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  budgets: Budget[];
};

/** O montador: agrupar por, medida, grafico, periodo e filtros. Mudar um deles ja troca o grafico se ele nao servir mais. */
export function CustomReportBuilder({ config, onChange, periodError, missing, accounts, categories, tags, budgets }: Props) {
  const charts = allowedCharts(config.groupBy, config.measure);
  const patch = (change: Partial<CustomConfig>) => onChange(normalize({ ...config, ...change }));

  return (
    <section aria-label="Montar relatório" className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id="custom-group-by" label="Agrupar por">
        {(field) => (
          <Select {...field} value={config.groupBy} onChange={(event) => patch({ groupBy: event.target.value as CustomConfig["groupBy"] })}>
            {GROUP_BY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="custom-measure" label="Medir">
        {(field) => (
          <Select {...field} value={config.measure} onChange={(event) => patch({ measure: event.target.value as CustomConfig["measure"] })}>
            {MEASURE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="custom-chart"
        label="Gráfico"
        hint="Linha só serve para agrupar por mês. Rosca não serve para mês nem para saldo."
      >
        {(field) => (
          <Select {...field} value={config.chart} onChange={(event) => patch({ chart: event.target.value as CustomConfig["chart"] })}>
            {CHART_OPTIONS.filter((option) => charts.includes(option.value)).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="custom-period" label="Período">
        {(field) => (
          <Select {...field} value={config.period} onChange={(event) => patch({ period: event.target.value as CustomConfig["period"] })}>
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {config.period === "fixed" && (
        <>
          <FormField id="custom-date-from" label="Data inicial" error={periodError}>
            {(field) => <Input {...field} type="date" value={config.dateFrom} onChange={(event) => patch({ dateFrom: event.target.value })} />}
          </FormField>
          <FormField id="custom-date-to" label="Data final">
            {(field) => <Input {...field} type="date" value={config.dateTo} onChange={(event) => patch({ dateTo: event.target.value })} />}
          </FormField>
        </>
      )}

      <FormField id="custom-account" label="Conta">
        {(field) => (
          <Select {...field} value={config.accountId} onChange={(event) => patch({ accountId: event.target.value })}>
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

      <FormField id="custom-category" label="Categoria">
        {(field) => (
          <Select {...field} value={config.categoryId} onChange={(event) => patch({ categoryId: event.target.value })}>
            <option value="">Todas</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="custom-tag" label="Tag">
        {(field) => (
          <Select {...field} value={config.tagId} onChange={(event) => patch({ tagId: event.target.value })}>
            <option value="">Todas</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="custom-budget" label="Orçamento">
        {(field) => (
          <Select {...field} value={config.budgetId} onChange={(event) => patch({ budgetId: event.target.value })}>
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

      {missing.length > 0 && (
        <Alert variant="destructive" className="sm:col-span-2 lg:col-span-3">
          Este relatório filtra por {missing.join(", ")} que não existe mais. Escolha outro valor, ou “Todas”, e salve de novo.
        </Alert>
      )}
    </section>
  );
}

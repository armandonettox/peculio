import type { Account } from "@/api/accounts";
import type { Budget } from "@/api/budgets";
import type { Category, Tag } from "@/api/labels";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  allowedCharts,
  chartOptions,
  groupByOptions,
  measureOptions,
  normalize,
  periodOptions,
  type CustomConfig,
} from "./custom-config";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const charts = allowedCharts(config.groupBy, config.measure);
  const patch = (change: Partial<CustomConfig>) => onChange(normalize({ ...config, ...change }));

  return (
    <section aria-label={t("reports.customReportBuilder.montarRelatorio")} className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField id="custom-group-by" label={t("reports.customReportBuilder.agruparPor")}>
        {(field) => (
          <Select {...field} value={config.groupBy} onChange={(event) => patch({ groupBy: event.target.value as CustomConfig["groupBy"] })}>
            {groupByOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="custom-measure" label={t("reports.customReportBuilder.medir")}>
        {(field) => (
          <Select {...field} value={config.measure} onChange={(event) => patch({ measure: event.target.value as CustomConfig["measure"] })}>
            {measureOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="custom-chart"
        label={t("reports.customReportBuilder.grafico")}
        hint={t("reports.customReportBuilder.linhaSoServePara")}
      >
        {(field) => (
          <Select {...field} value={config.chart} onChange={(event) => patch({ chart: event.target.value as CustomConfig["chart"] })}>
            {chartOptions().filter((option) => charts.includes(option.value)).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="custom-period" label={t("common.periodo")}>
        {(field) => (
          <Select {...field} value={config.period} onChange={(event) => patch({ period: event.target.value as CustomConfig["period"] })}>
            {periodOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {config.period === "fixed" && (
        <>
          <FormField id="custom-date-from" label={t("common.dataInicial")} error={periodError}>
            {(field) => <Input {...field} type="date" value={config.dateFrom} onChange={(event) => patch({ dateFrom: event.target.value })} />}
          </FormField>
          <FormField id="custom-date-to" label={t("common.dataFinal")}>
            {(field) => <Input {...field} type="date" value={config.dateTo} onChange={(event) => patch({ dateTo: event.target.value })} />}
          </FormField>
        </>
      )}

      <FormField id="custom-account" label={t("common.conta")}>
        {(field) => (
          <Select {...field} value={config.accountId} onChange={(event) => patch({ accountId: event.target.value })}>
            <option value="">{t("common.todas")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.active ? "" : ` ${t("reports.customReportBuilder.arquivada")}`}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="custom-category" label={t("common.categoria")}>
        {(field) => (
          <Select {...field} value={config.categoryId} onChange={(event) => patch({ categoryId: event.target.value })}>
            <option value="">{t("common.todas")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="custom-tag" label={t("common.tag")}>
        {(field) => (
          <Select {...field} value={config.tagId} onChange={(event) => patch({ tagId: event.target.value })}>
            <option value="">{t("common.todas")}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="custom-budget" label={t("common.orcamento")}>
        {(field) => (
          <Select {...field} value={config.budgetId} onChange={(event) => patch({ budgetId: event.target.value })}>
            <option value="">{t("reports.customReportBuilder.todos")}</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name}
                {budget.active ? "" : ` ${t("reports.customReportBuilder.arquivado")}`}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      {missing.length > 0 && (
        <Alert variant="destructive" className="sm:col-span-2 lg:col-span-3">
          {t("reports.customReportBuilder.esteRelatorioFiltraPor", { missing: missing.join(", ") })}
        </Alert>
      )}
    </section>
  );
}

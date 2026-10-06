import { useState } from "react";

import type { ImportPreview } from "@/api/imports";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  columnLabel,
  sampleTable,
  validateMapping,
  type AmountMode,
  type MappingErrors,
  type MappingForm,
} from "./mapping-model";
import { useTranslation } from "react-i18next";

type Props = {
  preview: ImportPreview;
  form: MappingForm;
  onFormChange: (form: MappingForm) => void;
  // Chamado so quando as colunas escolhidas fazem sentido para o arquivo
  onSubmit: (form: MappingForm) => void;
  onBack: () => void;
  pending: boolean;
  error: string | null;
};

/** Passo 2 (so CSV): a pessoa diz qual coluna e a data, a descricao e o valor. */
export function ImportMappingStep({ preview, form, onFormChange, onSubmit, onBack, pending, error }: Props) {
  const { t } = useTranslation();
  const [errors, setErrors] = useState<MappingErrors>({});
  const table = sampleTable(preview, form.hasHeader);
  const width = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 0);

  function change(patch: Partial<MappingForm>, ...cleared: (keyof MappingErrors)[]) {
    setErrors((current) => {
      const next = { ...current };
      for (const key of cleared) delete next[key];
      return next;
    });
    onFormChange({ ...form, ...patch });
  }

  function submit() {
    const found = validateMapping(form, width);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(form);
  }

  const columnSelect = (id: string, label: string, key: keyof MappingErrors, value: string, hint?: string) => (
    <FormField id={id} label={label} error={errors[key]} hint={hint}>
      {(props) => (
        <Select
          {...props}
          value={value}
          onChange={(event) => change({ [key]: event.target.value } as Partial<MappingForm>, key)}
        >
          <option value="">{t("imports.importMappingStep.escolhaAColuna")}</option>
          {Array.from({ length: width }, (_, index) => (
            <option key={index} value={String(index)}>
              {columnLabel(index, table.headers[index])}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
    >
      <p className="text-sm text-muted-foreground">
        {t("imports.importMappingStep.naoDeuParaDescobrir")}
      </p>

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-max text-left text-sm">
          <caption className="sr-only">{t("imports.importMappingStep.primeirasLinhasDoArquivo")}</caption>
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {Array.from({ length: width }, (_, index) => (
                <th key={index} scope="col" className="px-3 py-2 font-medium">
                  {columnLabel(index, table.headers[index])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: width }, (_, index) => (
                  <td key={index} className="max-w-56 truncate px-3 py-2" title={row[index]}>
                    {row[index] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.hasHeader}
          onChange={(event) => change({ hasHeader: event.target.checked }, "dateColumn", "descriptionColumn", "amountColumn", "debitColumn", "creditColumn")}
          className="accent-[var(--primary)]"
        />
        {t("imports.importMappingStep.aPrimeiraLinhaDo")}
      </label>

      <div className="grid grid-cols-1 max-w-3xl gap-4 sm:grid-cols-2">
        {columnSelect("import-date-column", t("imports.importMappingStep.colunaDaData"), "dateColumn", form.dateColumn)}
        {columnSelect("import-description-column", t("imports.importMappingStep.colunaDaDescricao"), "descriptionColumn", form.descriptionColumn)}
      </div>

      <fieldset className="flex max-w-3xl flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{t("imports.importMappingStep.comoOValorAparece")}</legend>
        {(
          [
            ["single", t("imports.importMappingStep.umaColunaComSinal")],
            ["split", t("imports.importMappingStep.duasColunasDebito")],
          ] as [AmountMode, string][]
        ).map(([mode, label]) => (
          <label key={mode} className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="import-amount-mode"
              checked={form.amountMode === mode}
              onChange={() => change({ amountMode: mode }, "amountColumn", "debitColumn", "creditColumn")}
              className="accent-[var(--primary)]"
            />
            {label}
          </label>
        ))}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {form.amountMode === "single" ? (
            columnSelect("import-amount-column", t("imports.importMappingStep.colunaDoValor"), "amountColumn", form.amountColumn)
          ) : (
            <>
              {columnSelect("import-debit-column", t("imports.importMappingStep.colunaDeDebito"), "debitColumn", form.debitColumn)}
              {columnSelect("import-credit-column", t("imports.importMappingStep.colunaDeCredito"), "creditColumn", form.creditColumn)}
            </>
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          {t("imports.importMappingStep.voltar")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("imports.importMappingStep.lendoOArquivo") : t("imports.importMappingStep.verPrevia")}
        </Button>
      </div>
    </form>
  );
}

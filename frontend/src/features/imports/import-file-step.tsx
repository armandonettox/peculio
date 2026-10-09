import { FileUp } from "lucide-react";
import { useRef, useState } from "react";

import type { Account } from "@/api/accounts";
import { IMPORT_ACCEPT, IMPORT_MAX_BYTES } from "@/api/imports";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatBytes } from "@/features/attachments/format";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type Props = {
  accounts: Account[];
  accountId: string;
  onAccountChange: (accountId: string) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
  pending: boolean;
  // Erro do servidor ao ler o arquivo
  error: string | null;
};

type Errors = { account?: string; file?: string };

/** Passo 1: a conta que recebe o extrato e o arquivo. */
export function ImportFileStep({ accounts, accountId, onAccountChange, file, onFileChange, onSubmit, pending, error }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [dragOver, setDragOver] = useState(false);

  function chooseFile(chosen: File | null) {
    setErrors((current) => ({ ...current, file: undefined }));
    onFileChange(chosen);
  }

  function submit() {
    const found: Errors = {};
    if (!accountId) found.account = t("imports.importFileStep.escolhaAContaQueVai");
    if (!file) found.file = t("imports.importFileStep.escolhaOArquivoDo");
    else if (file.size === 0) found.file = t("imports.importFileStep.oArquivoEstaVazio");
    else if (file.size > IMPORT_MAX_BYTES) {
      found.file = t("imports.importFileStep.oArquivoPassaDoLimite", { max: IMPORT_MAX_BYTES / (1024 * 1024) });
    }
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit();
  }

  return (
    <form
      className="mx-auto flex max-w-xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
    >
      {error && <Alert variant="destructive">{error}</Alert>}

      <FormField
        id="import-account"
        label={t("imports.importFileStep.contaQueRecebeO")}
        error={errors.account}
        hint={t("imports.importFileStep.osLancamentosEntramNesta")}
      >
        {(props) => (
          <Select
            {...props}
            value={accountId}
            onChange={(event) => {
              setErrors((current) => ({ ...current, account: undefined }));
              onAccountChange(event.target.value);
            }}
          >
            <option value="">{t("imports.importFileStep.escolhaUmaConta")}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency_code})
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id="import-file"
        label={t("imports.importFileStep.arquivoDoExtratoCsv")}
        error={errors.file}
        hint={t("imports.importFileStep.ateMbELinhas", { max: IMPORT_MAX_BYTES / (1024 * 1024) })}
      >
        {(props) => (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              chooseFile(event.dataTransfer.files[0] ?? null);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
              dragOver ? "border-primary-text bg-accent" : "border-border hover:bg-accent/50",
            )}
          >
            <input
              {...props}
              ref={inputRef}
              type="file"
              accept={IMPORT_ACCEPT}
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <FileUp className="size-8 text-muted-foreground" aria-hidden="true" />
            {file ? (
              <p className="min-w-0 break-words text-sm">
                {file.name} <span className="tabular-nums text-muted-foreground">({formatBytes(file.size)})</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("imports.importFileStep.arrasteOuClique")}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                inputRef.current?.click();
              }}
            >
              {file ? t("imports.importFileStep.trocarArquivo") : t("imports.importFileStep.escolherArquivo")}
            </Button>
          </div>
        )}
      </FormField>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("imports.importFileStep.lendoOArquivo") : t("imports.importFileStep.verPrevia")}
        </Button>
      </div>
    </form>
  );
}

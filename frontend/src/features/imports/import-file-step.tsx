import { FileUp } from "lucide-react";
import { useRef, useState } from "react";

import type { Account } from "@/api/accounts";
import { IMPORT_ACCEPT, IMPORT_MAX_BYTES } from "@/api/imports";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { formatBytes } from "@/features/attachments/format";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<Errors>({});

  function chooseFile(chosen: File | null) {
    setErrors((current) => ({ ...current, file: undefined }));
    onFileChange(chosen);
  }

  function submit() {
    const found: Errors = {};
    if (!accountId) found.account = "Escolha a conta que vai receber o extrato.";
    if (!file) found.file = "Escolha o arquivo do extrato.";
    else if (file.size === 0) found.file = "O arquivo está vazio.";
    else if (file.size > IMPORT_MAX_BYTES) {
      found.file = `O arquivo passa do limite de ${IMPORT_MAX_BYTES / (1024 * 1024)} MB.`;
    }
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit();
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
    >
      {error && <Alert variant="destructive">{error}</Alert>}

      <FormField
        id="import-account"
        label="Conta que recebe o extrato"
        error={errors.account}
        hint="Os lançamentos entram nesta conta. Dívidas não recebem extrato."
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
            <option value="">Escolha uma conta</option>
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
        label="Arquivo do extrato (CSV ou OFX)"
        error={errors.file}
        hint={`Até ${IMPORT_MAX_BYTES / (1024 * 1024)} MB e 5000 linhas. O arquivo não fica guardado: só é lido para mostrar a prévia.`}
      >
        {(props) => (
          <div className="flex flex-wrap items-center gap-3">
            <input
              {...props}
              ref={inputRef}
              type="file"
              accept={IMPORT_ACCEPT}
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
              <FileUp />
              {file ? "Trocar arquivo" : "Escolher arquivo"}
            </Button>
            {file && (
              <p className="min-w-0 break-words text-sm text-muted-foreground">
                {file.name} <span className="tabular-nums">({formatBytes(file.size)})</span>
              </p>
            )}
          </div>
        )}
      </FormField>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Lendo o arquivo..." : "Ver prévia"}
        </Button>
      </div>
    </form>
  );
}

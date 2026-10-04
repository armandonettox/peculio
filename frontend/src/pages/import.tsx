import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAccounts } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useConfirmImport, usePreviewImport, type ImportPreview, type ImportResult } from "@/api/imports";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ImportFileStep } from "@/features/imports/import-file-step";
import { ImportMappingStep } from "@/features/imports/import-mapping-step";
import { ImportPreviewStep } from "@/features/imports/import-preview-step";
import { buildMapping, emptyMappingForm, formFromMapping, type MappingForm } from "@/features/imports/mapping-model";
import { entriesText, newRows, rowsToImport } from "@/features/imports/preview-model";

type Step = "file" | "mapping" | "preview" | "done";

// Erros do arquivo trazem o motivo exato no texto do servidor (moeda diferente, arquivo vazio...)
function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.code === "import_file_invalid" || error.code === "import_too_many_rows")) {
    return `Não foi possível ler o arquivo: ${error.message}`;
  }
  return getErrorMessage(error);
}

const STEPS: { key: Step; label: string }[] = [
  { key: "file", label: "Arquivo" },
  { key: "mapping", label: "Colunas" },
  { key: "preview", label: "Prévia" },
  { key: "done", label: "Pronto" },
];

export default function ImportPage() {
  const accountsQuery = useAccounts({ includeArchived: false });
  const preview = usePreviewImport();
  const confirm = useConfirmImport();

  const [step, setStep] = useState<Step>("file");
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<ImportPreview | null>(null);
  const [form, setForm] = useState<MappingForm>(emptyMappingForm());
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Extrato so entra em conta de ativo (o servidor tambem recusa dividas)
  const accounts = (accountsQuery.data ?? []).filter((account) => account.type === "asset");
  // Uma conta so: nao ha o que escolher
  const effectiveAccountId = accountId || (accounts.length === 1 ? accounts[0].id : "");
  const account = accounts.find((item) => item.id === effectiveAccountId);

  function receive(next: ImportPreview) {
    setData(next);
    setError(null);
    if (next.format === "csv" && next.needs_mapping) {
      setForm(formFromMapping(null));
      setStep("mapping");
      return;
    }
    // O que fica marcado e decidido aqui, no momento em que a previa chega, e depois so a pessoa muda
    setChosen(newRows(next.rows));
    setForm(formFromMapping(next.mapping));
    setStep("preview");
  }

  async function readFile(mappingForm?: MappingForm) {
    if (!file || !effectiveAccountId) return;
    setError(null);
    try {
      const next = await preview.mutateAsync({
        accountId: effectiveAccountId,
        file,
        mapping: mappingForm ? buildMapping(mappingForm) : undefined,
      });
      receive(next);
    } catch (failure) {
      setError(importErrorMessage(failure));
    }
  }

  async function importRows() {
    if (!data || !effectiveAccountId) return;
    setError(null);
    try {
      setResult(await confirm.mutateAsync({ account_id: effectiveAccountId, rows: rowsToImport(data.rows, chosen) }));
      setStep("done");
    } catch (failure) {
      setError(importErrorMessage(failure));
    }
  }

  function startOver() {
    setStep("file");
    setFile(null);
    setData(null);
    setResult(null);
    setChosen(new Set());
    setForm(emptyMappingForm());
    setError(null);
  }

  let content;
  if (accountsQuery.isPending) {
    content = (
      <p className="text-sm text-muted-foreground" role="status">
        Carregando contas...
      </p>
    );
  } else if (accountsQuery.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(accountsQuery.error)}
        </Alert>
        <Button variant="outline" onClick={() => void accountsQuery.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (accounts.length === 0) {
    content = (
      <Alert>
        Você ainda não tem uma conta para receber o extrato. <Link to="/contas" className="font-medium underline">Crie uma conta</Link> primeiro.
      </Alert>
    );
  } else if (step === "file" || !data) {
    content = (
      <ImportFileStep
        accounts={accounts}
        accountId={effectiveAccountId}
        onAccountChange={setAccountId}
        file={file}
        onFileChange={setFile}
        onSubmit={() => void readFile()}
        pending={preview.isPending}
        error={error}
      />
    );
  } else if (step === "mapping") {
    content = (
      <ImportMappingStep
        preview={data}
        form={form}
        onFormChange={setForm}
        onSubmit={(chosenForm) => void readFile(chosenForm)}
        onBack={startOver}
        pending={preview.isPending}
        error={error}
      />
    );
  } else if (step === "preview") {
    content = (
      <ImportPreviewStep
        preview={data}
        currencyCode={account?.currency_code ?? "BRL"}
        accountName={account?.name ?? ""}
        chosen={chosen}
        onChosenChange={setChosen}
        onConfirm={() => void importRows()}
        onAdjustColumns={
          data.format === "csv"
            ? () => {
                setError(null);
                setStep("mapping");
              }
            : null
        }
        onBack={startOver}
        pending={confirm.isPending}
        error={error}
      />
    );
  } else {
    content = (
      <div className="flex max-w-xl flex-col items-start gap-4 rounded-lg border bg-card p-6">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent text-positive">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </span>
        <div role="status" className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {result && result.created > 0 ? `${entriesText(result.created)} importados` : "Nada foi importado"}
          </h2>
          {result && result.skipped > 0 && (
            <p className="text-sm text-muted-foreground">
              {entriesText(result.skipped)} {result.skipped === 1 ? "foi deixado" : "foram deixados"} de fora porque o banco já tinha enviado
              {result.skipped === 1 ? " esse" : " esses"} antes.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/transacoes">Ver lançamentos</Link>
          </Button>
          <Button variant="outline" onClick={startOver}>
            Importar outro extrato
          </Button>
        </div>
      </div>
    );
  }

  const showSteps = accounts.length > 0 && !accountsQuery.isPending && !accountsQuery.isError;
  // O passo das colunas so existe no CSV; no OFX a lista pula direto para a previa
  const visibleSteps = STEPS.filter((item) => item.key !== "mapping" || data?.format === "csv" || step === "mapping");

  return (
    <>
      <PageHeader title="Importar extrato" description="Traga os lançamentos de um extrato do banco (CSV ou OFX)" />

      {showSteps && (
        <ol className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Passos da importação">
          {visibleSteps.map((item, index) => (
            <li
              key={item.key}
              aria-current={item.key === step ? "step" : undefined}
              className={item.key === step ? "font-semibold text-primary-text" : "text-muted-foreground"}
            >
              {index + 1}. {item.label}
            </li>
          ))}
        </ol>
      )}

      {content}
    </>
  );
}

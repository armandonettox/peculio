import { useState, type FormEvent } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import {
  useCreateSavedReport,
  useUpdateSavedReport,
  type SavedReport,
} from "@/api/saved-reports";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toBody, type CustomConfig } from "./custom-config";

const MAX_NAME = 80;

type Props = {
  config: CustomConfig;
  // O relatorio salvo que esta aberto, se houver: da para atualiza-lo ou salvar um novo
  current: SavedReport | null;
  onSaved: (report: SavedReport) => void;
  onClose: () => void;
};

/** Pede o nome e salva o relatorio montado; com um relatorio aberto, oferece atualizar ele ou salvar um novo. */
export function SaveReportDialog({ config, current, onSaved, onClose }: Props) {
  const create = useCreateSavedReport();
  const update = useUpdateSavedReport();
  const [name, setName] = useState(current?.name ?? "");
  const [mode, setMode] = useState<"update" | "new">(current ? "update" : "new");
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const trimmed = name.trim();
    if (!trimmed) return setNameError("Informe o nome do relatório.");
    if (trimmed.length > MAX_NAME) return setNameError(`Use no máximo ${MAX_NAME} letras.`);
    setNameError(undefined);

    try {
      const body = toBody(config, trimmed);
      const saved = current && mode === "update" ? await update.mutateAsync({ id: current.id, body }) : await create.mutateAsync(body);
      onSaved(saved);
      onClose();
    } catch (failure) {
      const message = getErrorMessage(failure);
      // Nome repetido e do campo; o resto (limite, relatorio que sumiu) e do formulario
      if (failure instanceof ApiError && failure.code === "saved_report_name_taken") setNameError(message);
      else setFormError(message);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Salvar relatório</DialogTitle>
          <DialogDescription>
            O relatório guarda o agrupamento, a medida, o gráfico, o período e os filtros. Com um período como “Este mês”, ele se atualiza
            sozinho cada vez que você abrir.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          {current && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">O que fazer</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="save-mode" checked={mode === "update"} onChange={() => setMode("update")} className="accent-[var(--primary)]" />
                Atualizar “{current.name}”
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="save-mode" checked={mode === "new"} onChange={() => setMode("new")} className="accent-[var(--primary)]" />
                Salvar como um relatório novo
              </label>
            </fieldset>
          )}

          <FormField id="save-report-name" label="Nome" error={nameError}>
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                value={name}
                disabled={busy}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(undefined);
                }}
              />
            )}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

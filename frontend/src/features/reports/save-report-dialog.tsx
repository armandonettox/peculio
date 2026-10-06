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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
    if (!trimmed) return setNameError(t("reports.saveReportDialog.informeONome"));
    if (trimmed.length > MAX_NAME) return setNameError(t("reports.saveReportDialog.useNoMaximo", { max: MAX_NAME }));
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
          <DialogTitle>{t("reports.saveReportDialog.salvarRelatorio")}</DialogTitle>
          <DialogDescription>
            {t("reports.saveReportDialog.oRelatorioGuardaO")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          {current && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t("reports.saveReportDialog.oQueFazer")}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="save-mode" checked={mode === "update"} onChange={() => setMode("update")} className="accent-[var(--primary)]" />
                {t("reports.saveReportDialog.atualizar", { name: current.name })}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="save-mode" checked={mode === "new"} onChange={() => setMode("new")} className="accent-[var(--primary)]" />
                {t("reports.saveReportDialog.salvarComoUmRelatorio")}
              </label>
            </fieldset>
          )}

          <FormField id="save-report-name" label={t("common.nome")} error={nameError}>
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
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t("reports.saveReportDialog.salvando") : t("reports.saveReportDialog.salvar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

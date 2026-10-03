import { useState } from "react";

import { useAccounts } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import {
  useApplyRules,
  usePreviewRules,
  type Rule,
  type RuleApplied,
  type RulePreview,
  type RuleRun,
} from "@/api/rules";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { previewChanges, type NameLookups } from "./presentation";

type Props = {
  rules: Rule[];
  lookups: NameLookups;
  onClose: () => void;
};

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Filtros digitados -> corpo da API. Campos vazios saem; `rule_ids` so quando nem todas as regras valem. */
export function buildRun(
  filters: { dateFrom: string; dateTo: string; accountId: string },
  selected: string[],
  totalRules: number,
): RuleRun {
  const body: RuleRun = {};
  if (filters.dateFrom) body.date_from = filters.dateFrom;
  if (filters.dateTo) body.date_to = filters.dateTo;
  if (filters.accountId) body.account_id = filters.accountId;
  if (selected.length < totalRules) body.rule_ids = selected;
  return body;
}

export function BackfillDialog({ rules, lookups, onClose }: Props) {
  const activeRules = rules.filter((rule) => rule.active);
  const accounts = useAccounts({ includeArchived: true });
  const previewMutation = usePreviewRules();
  const applyMutation = useApplyRules();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [accountId, setAccountId] = useState("");
  // Guarda o que foi DESMARCADO, nao o que esta marcado: regras que chegam depois de o dialogo abrir
  // (a lista ainda carregava) ja nascem marcadas, e o que a pessoa desmarcou continua desmarcado
  const [excluded, setExcluded] = useState<string[]>([]);
  const selected = activeRules.filter((rule) => !excluded.includes(rule.id)).map((rule) => rule.id);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [run, setRun] = useState<RuleRun | null>(null);
  const [applied, setApplied] = useState<RuleApplied | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = previewMutation.isPending || applyMutation.isPending;
  const rangeError = dateFrom && dateTo && dateFrom > dateTo ? "A data inicial não pode ser depois da final." : undefined;

  // Mudar qualquer filtro invalida a previa: o que se aplica e sempre o que foi mostrado
  function changeFilter(change: () => void) {
    change();
    setPreview(null);
    setRun(null);
    setApplied(null);
    setError(null);
  }

  function toggleRule(id: string) {
    changeFilter(() => setExcluded((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id])));
  }

  async function handlePreview() {
    if (busy || rangeError || selected.length === 0) return;
    setError(null);
    setApplied(null);
    const body = buildRun({ dateFrom, dateTo, accountId }, selected, activeRules.length);
    try {
      setPreview(await previewMutation.mutateAsync(body));
      setRun(body);
    } catch (failure) {
      setPreview(null);
      setError(getErrorMessage(failure));
    }
  }

  async function handleApply() {
    if (busy || !run) return;
    setError(null);
    try {
      setApplied(await applyMutation.mutateAsync(run));
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aplicar nas transações antigas</DialogTitle>
          <DialogDescription>
            Veja primeiro o que mudaria. Só são preenchidos os campos que estão em branco: categoria, tags, orçamento e
            conta a pagar que você já escolheu ficam como estão.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {activeRules.length === 0 && <Alert>Você não tem regras ativas para aplicar.</Alert>}
          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="backfill-from" label="De" error={rangeError}>
              {(props) => (
                <Input {...props} type="date" value={dateFrom} onChange={(e) => changeFilter(() => setDateFrom(e.target.value))} />
              )}
            </FormField>
            <FormField id="backfill-to" label="Até">
              {(props) => (
                <Input {...props} type="date" value={dateTo} onChange={(e) => changeFilter(() => setDateTo(e.target.value))} />
              )}
            </FormField>
            <FormField id="backfill-account" label="Conta">
              {(props) => (
                <Select {...props} value={accountId} onChange={(e) => changeFilter(() => setAccountId(e.target.value))}>
                  <option value="">Todas as contas</option>
                  {(accounts.data ?? []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>

          {activeRules.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Regras</legend>
              {activeRules.map((rule) => (
                <label key={rule.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(rule.id)}
                    onChange={() => toggleRule(rule.id)}
                    className="accent-[var(--primary)]"
                  />
                  {rule.name}
                </label>
              ))}
            </fieldset>
          )}

          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={busy || Boolean(rangeError) || selected.length === 0}
            onClick={() => void handlePreview()}
          >
            {previewMutation.isPending ? "Calculando..." : "Ver prévia"}
          </Button>

          {preview && (
            <section aria-label="Prévia" className="flex flex-col gap-3">
              <p role="status" className="text-sm font-medium">
                {preview.changed === 0
                  ? `Nada para preencher em ${plural(preview.scanned, "lançamento", "lançamentos")}.`
                  : `${plural(preview.changed, "lançamento seria alterado", "lançamentos seriam alterados")} de ${preview.scanned}.`}
              </p>
              {preview.items.length > 0 && (
                <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                  {preview.items.map((item) => (
                    <li key={item.split_id} className="rounded-md border p-3 text-sm">
                      <p className="break-words font-medium">{item.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(item.date)} · {formatMoney(item.amount, item.currency_code)}
                      </p>
                      <ul className="mt-1">
                        {previewChanges(item, lookups).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
              {preview.truncated && (
                <p className="text-xs text-muted-foreground">
                  Mostrando os primeiros {preview.items.length}. A aplicação vale para todos os {preview.changed}.
                </p>
              )}
            </section>
          )}

          {applied && (
            <Alert role="status">
              Pronto: {plural(applied.changed, "lançamento atualizado", "lançamentos atualizados")}.
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {applied ? "Fechar" : "Cancelar"}
          </Button>
          {preview && preview.changed > 0 && !applied && (
            <Button type="button" disabled={busy} onClick={() => void handleApply()}>
              {applyMutation.isPending
                ? "Aplicando..."
                : `Aplicar em ${plural(preview.changed, "lançamento", "lançamentos")}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

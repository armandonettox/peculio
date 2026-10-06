import { useState, type FormEvent } from "react";

import {
  useCreateBudget,
  useUpdateBudget,
  type Budget,
  type BudgetCreate,
  type BudgetMode,
  type BudgetPeriod,
  type BudgetUpdate,
} from "@/api/budgets";
import { useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useAuth } from "@/auth/auth-context";
import { requiredError } from "@/auth/validation";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { parseMoneyInput, placesOf } from "@/lib/money";
import { periodLabel, PERIODS } from "./presentation";
import { useTranslation } from "react-i18next";

type Field = "name" | "amount";
type Errors = Partial<Record<Field, string>>;

// O backend usa ponto nos centavos; na tela mostramos virgula
const toInputText = (value: string) => value.replace(".", ",");

const SERVER_FIELDS: Record<string, Field> = { name: "name", amount: "amount" };

type Props = {
  // Sem `budget` o dialogo cria; com `budget` edita
  budget?: Budget;
  // Modo escolhido ao abrir para criar (a tela de envelopes abre ja em envelope)
  initialMode?: BudgetMode;
  onClose: () => void;
};

export function BudgetFormDialog({ budget, initialMode = "fixed", onClose }: Props) {
  const { t } = useTranslation();
  const editing = budget !== undefined;
  const { user } = useAuth();
  const currencies = useCurrencies();
  const create = useCreateBudget();
  const update = useUpdateBudget();

  const [name, setName] = useState(budget?.name ?? "");
  const [currency, setCurrency] = useState(budget?.currency_code ?? user?.default_currency ?? "BRL");
  const [amount, setAmount] = useState(budget ? toInputText(budget.amount ?? "") : "");
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? "monthly");
  // O modo nao muda depois de criado
  const [mode, setMode] = useState<BudgetMode>(budget?.mode ?? initialMode);
  const envelope = mode === "envelope";
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const placesMap = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const places = placesOf(currency, placesMap);
  const submitting = create.isPending || update.isPending;

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function handleServerError(error: unknown) {
    const message = getErrorMessage(error);
    if (!(error instanceof ApiError)) return setFormError(message);

    const serverErrors: Errors = {};
    for (const item of error.fieldErrors) {
      const field = SERVER_FIELDS[item.field];
      if (field) serverErrors[field] = item.message;
    }
    if (error.code === "budget_name_taken") serverErrors.name = message;
    if (error.code === "invalid_amount") serverErrors.amount = message;

    setErrors(serverErrors);
    const first = (["name", "amount"] as const).find((field) => serverErrors[field]);
    if (first) document.getElementById(`budget-${first}`)?.focus();
    if (!first || error.code === "validation_error") setFormError(message);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = { name: requiredError(name, t("budgets.budgetFormDialog.informeONome")) };
    let amountValue = "";
    // Envelope nao tem limite: o valor de cada mes e a distribuicao
    if (!envelope) {
      const parsed = parseMoneyInput(amount, places);
      if (amount.trim() === "") found.amount = t("budgets.budgetFormDialog.informeOValorDoLimite");
      else if (!parsed.ok) found.amount = parsed.error;
      else if (/^0+(\.0+)?$/.test(parsed.value) || parsed.value.startsWith("-")) {
        found.amount = t("budgets.budgetFormDialog.informeUmValorMaior");
      } else amountValue = parsed.value;
    }

    setErrors(found);
    const firstInvalid = (["name", "amount"] as const).find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`budget-${firstInvalid}`)?.focus();
      return;
    }

    try {
      if (!editing) {
        const body: BudgetCreate = envelope
          ? { name: name.trim(), currency_code: currency, mode: "envelope" }
          : { name: name.trim(), currency_code: currency, mode: "fixed", amount: amountValue, period };
        await create.mutateAsync(body);
      } else {
        // Manda so o que mudou, para nao sobrescrever sem querer
        const body: BudgetUpdate = {};
        if (name.trim() !== budget.name) body.name = name.trim();
        if (!envelope && amountValue !== budget.amount) body.amount = amountValue;
        if (!envelope && period !== budget.period) body.period = period;
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: budget.id, body });
      }
      onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? (envelope ? t("budgets.budgetFormDialog.editarEnvelope") : t("budgets.budgetFormDialog.editarOrcamento")) : envelope ? t("budgets.budgetFormDialog.novoEnvelope") : t("budgets.budgetFormDialog.novoOrcamento")}
          </DialogTitle>
          <DialogDescription>
            {envelope
              ? t("budgets.budgetFormDialog.voceDistribuiUmValor")
              : editing
                ? t("budgets.budgetFormDialog.mudarOValorOu")
                : t("budgets.budgetFormDialog.umLimiteDeGasto")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          {!editing && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t("common.tipo")}</legend>
              {(
                [
                  ["fixed", t("budgets.budgetFormDialog.limiteFixo"), t("budgets.budgetFormDialog.umTetoDeGasto")],
                  ["envelope", t("budgets.budgetFormDialog.envelope"), t("budgets.budgetFormDialog.voceDistribuiDinheiroPorMes")],
                ] as [BudgetMode, string, string][]
              ).map(([value, label, hint]) => (
                <label key={value} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="budget-mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="mt-0.5 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <FormField id="budget-name" label={t("common.nome")} error={errors.name}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearError("name");
                }}
              />
            )}
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="budget-currency" label={t("common.moeda")}>
              {(props) => (
                <Select {...props} value={currency} disabled={editing} onChange={(event) => setCurrency(event.target.value)}>
                  {/* Enquanto a lista carrega, mostra so a moeda atual */}
                  {(currencies.data ?? [{ code: currency, name: currency }]).map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} - {option.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            {!envelope && (
              <FormField id="budget-period" label={t("common.periodo")}>
                {(props) => (
                  <Select {...props} value={period} onChange={(event) => setPeriod(event.target.value as BudgetPeriod)}>
                    {PERIODS.map((option) => (
                      <option key={option} value={option}>
                        {periodLabel(option)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
          </div>

          {!envelope && (
            <FormField id="budget-amount" label={t("budgets.budgetFormDialog.limitePorPeriodo")} error={errors.amount}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    clearError("amount");
                  }}
                />
              )}
            </FormField>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("budgets.budgetFormDialog.salvando") : editing ? t("budgets.budgetFormDialog.salvar") : t("budgets.budgetFormDialog.criarOrcamento")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

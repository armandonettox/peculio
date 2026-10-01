import { useState, type FormEvent } from "react";

import {
  useCreateBudget,
  useUpdateBudget,
  type Budget,
  type BudgetCreate,
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
import { PERIOD_LABELS, PERIODS } from "./presentation";

type Field = "name" | "amount";
type Errors = Partial<Record<Field, string>>;

// O backend usa ponto nos centavos; na tela mostramos virgula
const toInputText = (value: string) => value.replace(".", ",");

const SERVER_FIELDS: Record<string, Field> = { name: "name", amount: "amount" };

type Props = {
  // Sem `budget` o dialogo cria; com `budget` edita
  budget?: Budget;
  onClose: () => void;
};

export function BudgetFormDialog({ budget, onClose }: Props) {
  const editing = budget !== undefined;
  const { user } = useAuth();
  const currencies = useCurrencies();
  const create = useCreateBudget();
  const update = useUpdateBudget();

  const [name, setName] = useState(budget?.name ?? "");
  const [currency, setCurrency] = useState(budget?.currency_code ?? user?.default_currency ?? "BRL");
  const [amount, setAmount] = useState(budget ? toInputText(budget.amount) : "");
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? "monthly");
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

    const found: Errors = { name: requiredError(name, "Informe o nome do orçamento.") };
    let amountValue = "";
    const parsed = parseMoneyInput(amount, places);
    if (amount.trim() === "") found.amount = "Informe o valor do limite.";
    else if (!parsed.ok) found.amount = parsed.error;
    else if (/^0+(\.0+)?$/.test(parsed.value) || parsed.value.startsWith("-")) {
      found.amount = "Informe um valor maior que zero.";
    } else amountValue = parsed.value;

    setErrors(found);
    const firstInvalid = (["name", "amount"] as const).find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`budget-${firstInvalid}`)?.focus();
      return;
    }

    try {
      if (!editing) {
        const body: BudgetCreate = { name: name.trim(), currency_code: currency, amount: amountValue, period };
        await create.mutateAsync(body);
      } else {
        // Manda so o que mudou, para nao sobrescrever sem querer
        const body: BudgetUpdate = {};
        if (name.trim() !== budget.name) body.name = name.trim();
        if (amountValue !== budget.amount) body.amount = amountValue;
        if (period !== budget.period) body.period = period;
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
          <DialogTitle>{editing ? "Editar orçamento" : "Novo orçamento"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Mudar o valor ou o período vale também para os períodos anteriores. A moeda não pode mudar."
              : "Um limite de gasto que se repete a cada período, por exemplo Mercado: R$ 800 por mês."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="budget-name" label="Nome" error={errors.name}>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="budget-currency" label="Moeda">
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

            <FormField id="budget-period" label="Período">
              {(props) => (
                <Select {...props} value={period} onChange={(event) => setPeriod(event.target.value as BudgetPeriod)}>
                  {PERIODS.map((option) => (
                    <option key={option} value={option}>
                      {PERIOD_LABELS[option]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>

          <FormField id="budget-amount" label="Limite por período" error={errors.amount}>
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : editing ? "Salvar" : "Criar orçamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

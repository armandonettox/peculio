import { useState, type FormEvent } from "react";

import { useCurrencies } from "@/api/accounts";
import {
  useCreateBill,
  useUpdateBill,
  type Bill,
  type BillCreate,
  type BillFrequency,
  type BillUpdate,
} from "@/api/bills";
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
import { todayLocal } from "@/lib/dates";
import { isNegativeMoney, negateMoney, parseMoneyInput, placesOf, sumMoney } from "@/lib/money";
import { FREQUENCIES, FREQUENCY_LABELS } from "./presentation";

type Field = "name" | "min" | "max" | "date";
type Errors = Partial<Record<Field, string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// O backend usa ponto nos centavos; na tela mostramos virgula
const toInputText = (value: string) => value.replace(".", ",");

const SERVER_FIELDS: Record<string, Field> = {
  name: "name",
  amount_min: "min",
  amount_max: "max",
  first_due_date: "date",
};

const FIELD_ORDER: Field[] = ["name", "min", "max", "date"];

type Props = {
  // Sem `bill` o dialogo cria; com `bill` edita
  bill?: Bill;
  onClose: () => void;
};

export function BillFormDialog({ bill, onClose }: Props) {
  const editing = bill !== undefined;
  const { user } = useAuth();
  const currencies = useCurrencies();
  const create = useCreateBill();
  const update = useUpdateBill();

  const [name, setName] = useState(bill?.name ?? "");
  const [currency, setCurrency] = useState(bill?.currency_code ?? user?.default_currency ?? "BRL");
  const [min, setMin] = useState(bill ? toInputText(bill.amount_min) : "");
  const [max, setMax] = useState(bill && bill.amount_max !== bill.amount_min ? toInputText(bill.amount_max) : "");
  const [match, setMatch] = useState(bill?.match_text ?? "");
  const [date, setDate] = useState(bill?.first_due_date ?? todayLocal());
  const [frequency, setFrequency] = useState<BillFrequency>(bill?.frequency ?? "monthly");
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
    if (error.code === "bill_name_taken") serverErrors.name = message;
    if (error.code === "invalid_amount") serverErrors.min = message;

    setErrors(serverErrors);
    const first = FIELD_ORDER.find((field) => serverErrors[field]);
    if (first) document.getElementById(`bill-${first}`)?.focus();
    if (!first || error.code === "validation_error") setFormError(message);
  }

  /** Valor positivo digitado, ou o erro para mostrar no campo. */
  function parsePositive(text: string, requiredMessage: string): { value: string } | { error: string } {
    if (text.trim() === "") return { error: requiredMessage };
    const parsed = parseMoneyInput(text, places);
    if (!parsed.ok) return { error: parsed.error };
    if (/^0+(\.0+)?$/.test(parsed.value) || parsed.value.startsWith("-")) {
      return { error: "Informe um valor maior que zero." };
    }
    return { value: parsed.value };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = { name: requiredError(name, "Informe o nome da conta.") };
    const minResult = parsePositive(min, "Informe o valor.");
    if ("error" in minResult) found.min = minResult.error;
    // Sem valor maximo, a conta tem preco fixo: o maximo e igual ao minimo
    const maxResult = max.trim() === "" ? minResult : parsePositive(max, "Informe o valor.");
    if (max.trim() !== "" && "error" in maxResult) found.max = maxResult.error;
    if (
      "value" in minResult &&
      "value" in maxResult &&
      isNegativeMoney(sumMoney([maxResult.value, negateMoney(minResult.value)], places))
    ) {
      found.max = "O valor máximo não pode ser menor que o mínimo.";
    }
    if (!DATE_PATTERN.test(date)) found.date = "Informe uma data válida.";

    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((field) => found[field]);
    if (firstInvalid || !("value" in minResult) || !("value" in maxResult)) {
      document.getElementById(`bill-${firstInvalid ?? "min"}`)?.focus();
      return;
    }

    const matchValue = match.trim() || null;
    try {
      if (!editing) {
        const body: BillCreate = {
          name: name.trim(),
          currency_code: currency,
          amount_min: minResult.value,
          amount_max: maxResult.value,
          match_text: matchValue,
          first_due_date: date,
          frequency,
        };
        await create.mutateAsync(body);
      } else {
        // Manda so o que mudou, para nao sobrescrever sem querer
        const body: BillUpdate = {};
        if (name.trim() !== bill.name) body.name = name.trim();
        if (minResult.value !== bill.amount_min) body.amount_min = minResult.value;
        if (maxResult.value !== bill.amount_max) body.amount_max = maxResult.value;
        if (matchValue !== bill.match_text) body.match_text = matchValue;
        if (date !== bill.first_due_date) body.first_due_date = date;
        if (frequency !== bill.frequency) body.frequency = frequency;
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: bill.id, body });
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
          <DialogTitle>{editing ? "Editar conta a pagar" : "Nova conta a pagar"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Mudar a data ou a frequência recalcula todos os vencimentos. A moeda não pode mudar."
              : "Algo que vence sempre, como aluguel ou uma assinatura. O app liga sozinho os lançamentos que combinam."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="bill-name" label="Nome" error={errors.name}>
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
            <FormField id="bill-currency" label="Moeda">
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

            <FormField id="bill-frequency" label="Frequência">
              {(props) => (
                <Select
                  {...props}
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as BillFrequency)}
                >
                  {FREQUENCIES.map((option) => (
                    <option key={option} value={option}>
                      {FREQUENCY_LABELS[option]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="bill-min" label="Valor mínimo" error={errors.min}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={min}
                  onChange={(event) => {
                    setMin(event.target.value);
                    clearError("min");
                  }}
                />
              )}
            </FormField>

            <FormField
              id="bill-max"
              label="Valor máximo"
              error={errors.max}
              hint="Deixe em branco se o valor é sempre o mesmo."
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={max}
                  onChange={(event) => {
                    setMax(event.target.value);
                    clearError("max");
                  }}
                />
              )}
            </FormField>
          </div>

          <FormField id="bill-date" label="Primeiro vencimento" error={errors.date}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  clearError("date");
                }}
              />
            )}
          </FormField>

          <FormField
            id="bill-match"
            label="Texto para ligar sozinho"
            hint="Quando uma saída tiver este texto na descrição ou no nome de quem recebeu, e o valor estiver na faixa, ela é ligada a esta conta. Deixe em branco para ligar só à mão."
          >
            {(props) => (
              <Input {...props} autoComplete="off" value={match} onChange={(event) => setMatch(event.target.value)} />
            )}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : editing ? "Salvar" : "Criar conta a pagar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

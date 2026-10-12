import { useState, type FormEvent } from "react";

import { useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import {
  useCreateRecurrence,
  useUpdateRecurrence,
  type Recurrence,
  type RecurrenceCreate,
  type RecurrenceFrequency,
  type RecurrenceUpdate,
} from "@/api/recurrences";
import { useAuth } from "@/auth/auth-context";
import { requiredError } from "@/auth/validation";
import { FormField } from "@/components/form-field";
import { MoneyInput } from "@/components/money-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { appToday } from "@/lib/dates";
import { isNegativeMoney, negateMoney, parseMoneyInput, placesOf, sumMoney } from "@/lib/money";
import { REMINDER_FREQUENCIES, frequencyLabel } from "./presentation";
import { useTranslation } from "react-i18next";

type Field = "name" | "min" | "max" | "date";
type Errors = Partial<Record<Field, string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// O backend usa ponto nos centavos; na tela mostramos virgula
const toInputText = (value: string) => value.replace(".", ",");

const SERVER_FIELDS: Record<string, Field> = {
  name: "name",
  amount_min: "min",
  amount_max: "max",
  first_date: "date",
};

const FIELD_ORDER: Field[] = ["name", "min", "max", "date"];

type Props = {
  // Sem `recurrence` o dialogo cria; com `recurrence` edita (sempre do modo de lembrete)
  recurrence?: Recurrence;
  onClose: () => void;
};

export function ReminderFormDialog({ recurrence, onClose }: Props) {
  const { t } = useTranslation();
  const editing = recurrence !== undefined;
  const { user } = useAuth();
  const currencies = useCurrencies();
  const create = useCreateRecurrence();
  const update = useUpdateRecurrence();

  const [name, setName] = useState(recurrence?.name ?? "");
  const [currency, setCurrency] = useState(recurrence?.currency_code ?? user?.default_currency ?? "BRL");
  const [min, setMin] = useState(recurrence ? toInputText(recurrence.amount_min ?? "0") : "");
  const [max, setMax] = useState(recurrence && recurrence.amount_max !== recurrence.amount_min ? toInputText(recurrence.amount_max ?? "0") : "");
  const [match, setMatch] = useState(recurrence?.match_text ?? "");
  const [date, setDate] = useState(recurrence?.first_date ?? appToday());
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(recurrence?.frequency ?? "monthly");
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
      return { error: t("recurrences.reminderFormDialog.informeUmValorMaior") };
    }
    return { value: parsed.value };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = { name: requiredError(name, t("recurrences.reminderFormDialog.informeONome")) };
    const minResult = parsePositive(min, t("recurrences.reminderFormDialog.informeOValor"));
    if ("error" in minResult) found.min = minResult.error;
    // Sem valor maximo, o lembrete tem preco fixo: o maximo e igual ao minimo
    const maxResult = max.trim() === "" ? minResult : parsePositive(max, t("recurrences.reminderFormDialog.informeOValor"));
    if (max.trim() !== "" && "error" in maxResult) found.max = maxResult.error;
    if (
      "value" in minResult &&
      "value" in maxResult &&
      isNegativeMoney(sumMoney([maxResult.value, negateMoney(minResult.value)], places))
    ) {
      found.max = t("recurrences.reminderFormDialog.valorMaximoNaoPode");
    }
    if (!DATE_PATTERN.test(date)) found.date = t("recurrences.reminderFormDialog.informeUmaData");

    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((field) => found[field]);
    if (firstInvalid || !("value" in minResult) || !("value" in maxResult)) {
      document.getElementById(`bill-${firstInvalid ?? "min"}`)?.focus();
      return;
    }

    const matchValue = match.trim() || null;
    try {
      if (!editing) {
        const body: RecurrenceCreate = {
          name: name.trim(),
          auto_create: false,
          frequency,
          first_date: date,
          currency_code: currency,
          amount_min: minResult.value,
          amount_max: maxResult.value,
          match_text: matchValue,
        };
        await create.mutateAsync(body);
      } else {
        // Manda so o que mudou, para nao sobrescrever sem querer
        const body: RecurrenceUpdate = {};
        if (name.trim() !== recurrence.name) body.name = name.trim();
        if (minResult.value !== recurrence.amount_min) body.amount_min = minResult.value;
        if (maxResult.value !== recurrence.amount_max) body.amount_max = maxResult.value;
        if (matchValue !== recurrence.match_text) body.match_text = matchValue;
        if (date !== recurrence.first_date) body.first_date = date;
        if (frequency !== recurrence.frequency) body.frequency = frequency;
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: recurrence.id, body });
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
          <DialogTitle>{editing ? t("recurrences.reminderFormDialog.editarLembrete") : t("recurrences.reminderFormDialog.novoLembrete")}</DialogTitle>
          <DialogDescription>
            {editing
              ? t("recurrences.reminderFormDialog.mudarADataOu")
              : t("recurrences.reminderFormDialog.algoQueVenceSempre")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="bill-name" label={t("common.nome")} error={errors.name}>
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
            <FormField id="bill-currency" label={t("common.moeda")}>
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

            <FormField id="bill-frequency" label={t("recurrences.reminderFormDialog.frequencia")}>
              {(props) => (
                <Select
                  {...props}
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}
                >
                  {REMINDER_FREQUENCIES.map((option) => (
                    <option key={option} value={option}>
                      {frequencyLabel(option)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="bill-min" label={t("recurrences.reminderFormDialog.valorMinimo")} error={errors.min}>
              {(props) => (
                <MoneyInput
                  {...props}
                  placeholder="0,00"
                  places={places}
                  value={min}
                  onChange={(text) => {
                    setMin(text);
                    clearError("min");
                  }}
                />
              )}
            </FormField>

            <FormField
              id="bill-max"
              label={t("recurrences.reminderFormDialog.valorMaximo")}
              error={errors.max}
              hint={t("recurrences.reminderFormDialog.deixeEmBrancoSe")}
            >
              {(props) => (
                <MoneyInput
                  {...props}
                  placeholder="0,00"
                  places={places}
                  value={max}
                  onChange={(text) => {
                    setMax(text);
                    clearError("max");
                  }}
                />
              )}
            </FormField>
          </div>

          <FormField id="bill-date" label={t("recurrences.reminderFormDialog.primeiroVencimento")} error={errors.date}>
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
            label={t("recurrences.reminderFormDialog.textoParaLigarSozinho")}
            hint={t("recurrences.reminderFormDialog.quandoUmaSaidaTiver")}
          >
            {(props) => (
              <Input {...props} autoComplete="off" value={match} onChange={(event) => setMatch(event.target.value)} />
            )}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("recurrences.reminderFormDialog.salvando") : editing ? t("recurrences.reminderFormDialog.salvar") : t("recurrences.reminderFormDialog.criarLembrete")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

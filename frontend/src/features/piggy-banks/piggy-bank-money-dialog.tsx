import { useState, type FormEvent } from "react";

import { useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useAddPiggyBankEvent, type PiggyBank } from "@/api/piggy-banks";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { appToday } from "@/lib/dates";
import { formatMoney, parseMoneyInput, placesOf } from "@/lib/money";

type Field = "amount" | "date";
type Errors = Partial<Record<Field, string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Props = {
  piggy: PiggyBank;
  kind: "add" | "remove";
  onClose: () => void;
};

/** Guardar ou retirar dinheiro de um cofrinho. */
export function PiggyBankMoneyDialog({ piggy, kind, onClose }: Props) {
  const adding = kind === "add";
  const currencies = useCurrencies();
  const addEvent = useAddPiggyBankEvent();

  const today = appToday();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const placesMap = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const places = placesOf(piggy.currency_code, placesMap);
  const submitting = addEvent.isPending;

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = {};
    let amountValue = "";
    if (amount.trim() === "") found.amount = "Informe o valor.";
    else {
      const parsed = parseMoneyInput(amount, places);
      if (!parsed.ok) found.amount = parsed.error;
      else if (/^0+(\.0+)?$/.test(parsed.value) || parsed.value.startsWith("-")) {
        found.amount = "Informe um valor maior que zero.";
      } else amountValue = parsed.value;
    }
    if (!DATE_PATTERN.test(date)) found.date = "Informe uma data válida.";
    else if (date > today) found.date = "A data não pode ser no futuro.";

    setErrors(found);
    const firstInvalid = (["amount", "date"] as const).find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`money-${firstInvalid}`)?.focus();
      return;
    }

    try {
      await addEvent.mutateAsync({
        id: piggy.id,
        body: { kind, amount: amountValue, date, note: note.trim() || null },
      });
      onClose();
    } catch (error) {
      const message = getErrorMessage(error);
      // Falta de saldo ou de guardado e problema do valor: fica no campo
      if (
        error instanceof ApiError &&
        ["piggy_bank_not_enough_available", "piggy_bank_not_enough_saved", "invalid_amount"].includes(error.code)
      ) {
        setErrors({ amount: message });
        document.getElementById("money-amount")?.focus();
      } else setFormError(message);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{adding ? "Guardar dinheiro" : "Retirar dinheiro"}</DialogTitle>
          <DialogDescription>
            {adding
              ? `Reserva um valor de ${piggy.account_name} para ${piggy.name}. Disponível agora: ${formatMoney(piggy.account_available, piggy.currency_code)}.`
              : `Devolve um valor de ${piggy.name} ao disponível de ${piggy.account_name}. Guardado agora: ${formatMoney(piggy.saved, piggy.currency_code)}.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="money-amount" label={`Valor (${piggy.currency_code})`} error={errors.amount}>
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

            <FormField id="money-date" label="Data" error={errors.date}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  max={today}
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    clearError("date");
                  }}
                />
              )}
            </FormField>
          </div>

          <FormField id="money-note" label="Nota (opcional)">
            {(props) => (
              <Input {...props} autoComplete="off" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
            )}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : adding ? "Guardar" : "Retirar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

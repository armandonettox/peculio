import { useState, type FormEvent } from "react";

import { useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useMoveMoney, type EnvelopeGroup } from "@/api/envelopes";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatMoney, isNegativeMoney, negateMoney, parseMoneyInput, placesOf, sumMoney } from "@/lib/money";
import { signOf } from "./presentation";

type Field = "from" | "to" | "amount";
type Errors = Partial<Record<Field, string>>;

type Props = {
  month: string;
  group: EnvelopeGroup;
  // Envelope escolhido ao abrir (ex: o que estourou, que recebe)
  initialTo?: string;
  onClose: () => void;
};

/** Passa dinheiro de um envelope para outro no mes. E assim que se cobre um estouro. */
export function MoveMoneyDialog({ month, group, initialTo = "", onClose }: Props) {
  const currencies = useCurrencies();
  const move = useMoveMoney(month);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(initialTo);
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const placesMap = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const places = placesOf(group.currency_code, placesMap);
  const source = group.envelopes.find((item) => item.budget_id === from);
  const submitting = move.isPending;

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = {};
    if (!from) found.from = "Escolha de onde tirar.";
    if (!to) found.to = "Escolha para onde levar.";
    else if (to === from) found.to = "Escolha um envelope diferente do de origem.";
    let value = "";
    const parsed = parseMoneyInput(amount, places);
    if (!parsed.ok) found.amount = parsed.error;
    else if (signOf(parsed.value) <= 0) found.amount = "Informe um valor maior que zero.";
    else if (source && isNegativeMoney(sumMoney([source.available, negateMoney(parsed.value)], places))) {
      found.amount = `O envelope ${source.name} só tem ${formatMoney(source.available, group.currency_code)} disponível.`;
    } else value = parsed.value;

    setErrors(found);
    const firstInvalid = (["from", "to", "amount"] as const).find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`move-${firstInvalid}`)?.focus();
      return;
    }

    try {
      await move.mutateAsync({ fromBudgetId: from, toBudgetId: to, amount: value });
      onClose();
    } catch (error) {
      const message = getErrorMessage(error);
      if (error instanceof ApiError && (error.code === "envelope_not_enough" || error.code === "invalid_amount")) {
        setErrors({ amount: message });
        document.getElementById("move-amount")?.focus();
      } else {
        setFormError(message);
      }
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover dinheiro</DialogTitle>
          <DialogDescription>Passa dinheiro de um envelope para outro neste mês. É assim que você cobre um estouro.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="move-from" label="Tirar de" error={errors.from}>
            {(props) => (
              <Select
                {...props}
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  clearError("from");
                }}
              >
                <option value="">Escolha o envelope</option>
                {group.envelopes.map((item) => (
                  <option key={item.budget_id} value={item.budget_id}>
                    {item.name} ({formatMoney(item.available, group.currency_code)} disponível)
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField id="move-to" label="Levar para" error={errors.to}>
            {(props) => (
              <Select
                {...props}
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  clearError("to");
                }}
              >
                <option value="">Escolha o envelope</option>
                {group.envelopes.map((item) => (
                  <option key={item.budget_id} value={item.budget_id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField id="move-amount" label={`Valor (${group.currency_code})`} error={errors.amount}>
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
              {submitting ? "Movendo..." : "Mover"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

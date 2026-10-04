import { useState, type FormEvent } from "react";

import { useCurrencies } from "@/api/accounts";
import { useBills } from "@/api/bills";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useRemoveTemplate, useSetTemplate, type Envelope, type TemplateIn, type TemplateKind } from "@/api/envelopes";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatMoney, parseMoneyInput, placesOf } from "@/lib/money";
import { signOf, toInputText } from "./presentation";
import { KIND_OPTIONS } from "./template-presentation";

type Field = "amount" | "month" | "bill";
type Errors = Partial<Record<Field, string>>;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type Props = {
  envelope: Envelope;
  currencyCode: string;
  onClose: () => void;
};

/** Define (ou troca, ou tira) o template de um envelope. Nada e distribuido aqui: so quando mandar aplicar. */
export function TemplateDialog({ envelope, currencyCode, onClose }: Props) {
  const current = envelope.template ?? null;
  const currencies = useCurrencies();
  const bills = useBills({ activeOnly: true });
  const set = useSetTemplate();
  const remove = useRemoveTemplate();

  const [kind, setKind] = useState<TemplateKind>(current?.kind ?? "fixed");
  const [amount, setAmount] = useState(current?.amount ? toInputText(current.amount) : "");
  const [month, setMonth] = useState(current?.target_month ? current.target_month.slice(0, 7) : "");
  const [billId, setBillId] = useState(current?.bill_id ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const places = placesOf(currencyCode, Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places])));
  // So contas na moeda do envelope servem
  const billOptions = (bills.data ?? []).filter((bill) => bill.currency_code === currencyCode);
  const busy = set.isPending || remove.isPending;
  const needsAmount = kind === "fixed" || kind === "by_date";

  function clearError(field: Field) {
    setErrors((existing) => (existing[field] ? { ...existing, [field]: undefined } : existing));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);

    const found: Errors = {};
    let value = "";
    if (needsAmount) {
      const parsed = parseMoneyInput(amount, places);
      if (!parsed.ok) found.amount = parsed.error;
      else if (signOf(parsed.value) <= 0) found.amount = "Informe um valor maior que zero.";
      else value = parsed.value;
    }
    if (kind === "by_date" && !MONTH_PATTERN.test(month)) found.month = "Escolha o mês em que a meta precisa estar pronta.";
    if (kind === "bill" && !billId) found.bill = "Escolha a conta a pagar.";
    setErrors(found);
    const firstInvalid = (["amount", "month", "bill"] as const).find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`template-${firstInvalid}`)?.focus();
      return;
    }

    // Cada tipo manda so os campos dele
    const body: TemplateIn =
      kind === "fixed"
        ? { kind, amount: value }
        : kind === "by_date"
          ? { kind, amount: value, target_month: month }
          : kind === "bill"
            ? { kind, bill_id: billId }
            : { kind };
    try {
      await set.mutateAsync({ budgetId: envelope.budget_id, body });
      onClose();
    } catch (error) {
      const message = getErrorMessage(error);
      if (error instanceof ApiError && error.code === "invalid_amount") {
        setErrors({ amount: message });
        document.getElementById("template-amount")?.focus();
      } else {
        setFormError(message);
      }
    }
  }

  async function removeTemplate() {
    setFormError(null);
    try {
      await remove.mutateAsync(envelope.budget_id);
      onClose();
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Template de {envelope.name}</DialogTitle>
          <DialogDescription>
            Diz quanto distribuir a este envelope por mês. Nada muda sozinho: você aplica os templates pela página, vendo antes o
            que vai acontecer.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Tipo</legend>
            {KIND_OPTIONS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="template-kind"
                  checked={kind === option.value}
                  onChange={() => {
                    setKind(option.value);
                    setErrors({});
                  }}
                  className="mt-0.5 accent-[var(--primary)]"
                />
                <span>
                  <span className="font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {needsAmount && (
            <FormField id="template-amount" label={kind === "fixed" ? `Valor por mês (${currencyCode})` : `Meta (${currencyCode})`} error={errors.amount}>
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

          {kind === "by_date" && (
            <FormField id="template-month" label="Meta pronta até o mês" error={errors.month}>
              {(props) => (
                <Input
                  {...props}
                  type="month"
                  value={month}
                  onChange={(event) => {
                    setMonth(event.target.value);
                    clearError("month");
                  }}
                />
              )}
            </FormField>
          )}

          {kind === "bill" && (
            <FormField
              id="template-bill"
              label="Conta a pagar"
              error={errors.bill}
              hint={billOptions.length === 0 && !bills.isPending ? `Você não tem conta a pagar em ${currencyCode}.` : undefined}
            >
              {(props) => (
                <Select
                  {...props}
                  value={billId}
                  onChange={(event) => {
                    setBillId(event.target.value);
                    clearError("bill");
                  }}
                >
                  <option value="">Escolha a conta</option>
                  {billOptions.map((bill) => (
                    <option key={bill.id} value={bill.id}>
                      {bill.name} (até {formatMoney(bill.amount_max, bill.currency_code)})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}

          <DialogFooter>
            {current && (
              <Button type="button" variant="outline" className="text-destructive sm:mr-auto" onClick={() => void removeTemplate()} disabled={busy}>
                Tirar template
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {set.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

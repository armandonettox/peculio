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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
    if (!from) found.from = t("envelopes.moveMoneyDialog.escolhaDeOnde");
    if (!to) found.to = t("envelopes.moveMoneyDialog.escolhaParaOnde");
    else if (to === from) found.to = t("envelopes.moveMoneyDialog.escolhaUmEnvelopeDiferente");
    let value = "";
    const parsed = parseMoneyInput(amount, places);
    if (!parsed.ok) found.amount = parsed.error;
    else if (signOf(parsed.value) <= 0) found.amount = t("envelopes.moveMoneyDialog.informeUmValorMaior");
    else if (source && isNegativeMoney(sumMoney([source.available, negateMoney(parsed.value)], places))) {
      found.amount = t("envelopes.moveMoneyDialog.oEnvelopeSoTem", {
        name: source.name,
        amount: formatMoney(source.available, group.currency_code),
      });
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
          <DialogTitle>{t("envelopes.moveMoneyDialog.moverDinheiro")}</DialogTitle>
          <DialogDescription>{t("envelopes.moveMoneyDialog.passaDinheiroDeUm")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="move-from" label={t("envelopes.moveMoneyDialog.tirarDe")} error={errors.from}>
            {(props) => (
              <Select
                {...props}
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  clearError("from");
                }}
              >
                <option value="">{t("envelopes.moveMoneyDialog.escolhaOEnvelope")}</option>
                {group.envelopes.map((item) => (
                  <option key={item.budget_id} value={item.budget_id}>
                    {t("envelopes.moveMoneyDialog.itemDisponivel", { name: item.name, amount: formatMoney(item.available, group.currency_code) })}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField id="move-to" label={t("envelopes.moveMoneyDialog.levarPara")} error={errors.to}>
            {(props) => (
              <Select
                {...props}
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  clearError("to");
                }}
              >
                <option value="">{t("envelopes.moveMoneyDialog.escolhaOEnvelope")}</option>
                {group.envelopes.map((item) => (
                  <option key={item.budget_id} value={item.budget_id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField id="move-amount" label={t("envelopes.moveMoneyDialog.valor", { currency: group.currency_code })} error={errors.amount}>
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
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("envelopes.moveMoneyDialog.movendo") : t("envelopes.moveMoneyDialog.mover")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

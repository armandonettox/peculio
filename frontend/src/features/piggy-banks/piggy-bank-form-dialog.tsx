import { useState, type FormEvent } from "react";

import { useAccounts, useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import {
  useCreatePiggyBank,
  useUpdatePiggyBank,
  type PiggyBank,
  type PiggyBankCreate,
  type PiggyBankUpdate,
} from "@/api/piggy-banks";
import { requiredError } from "@/auth/validation";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { parseMoneyInput, placesOf } from "@/lib/money";
import { useTranslation } from "react-i18next";

type Field = "name" | "account" | "amount" | "date";
type Errors = Partial<Record<Field, string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_ORDER: Field[] = ["name", "account", "amount", "date"];

// O backend usa ponto nos centavos; na tela mostramos virgula
const toInputText = (value: string) => value.replace(".", ",");

const SERVER_FIELDS: Record<string, Field> = {
  name: "name",
  account_id: "account",
  target_amount: "amount",
  target_date: "date",
};

type Props = {
  // Sem `piggy` o dialogo cria; com `piggy` edita
  piggy?: PiggyBank;
  onClose: () => void;
};

export function PiggyBankFormDialog({ piggy, onClose }: Props) {
  const { t } = useTranslation();
  const editing = piggy !== undefined;
  const accounts = useAccounts({ includeArchived: false });
  const currencies = useCurrencies();
  const create = useCreatePiggyBank();
  const update = useUpdatePiggyBank();

  // Cofrinho so em conta de ativos (dividas nao guardam dinheiro)
  const assetAccounts = (accounts.data ?? []).filter((account) => account.type === "asset");

  const [name, setName] = useState(piggy?.name ?? "");
  const [accountId, setAccountId] = useState(piggy?.account_id ?? "");
  const [amount, setAmount] = useState(piggy ? toInputText(piggy.target_amount) : "");
  const [date, setDate] = useState(piggy?.target_date ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const chosen = editing ? undefined : assetAccounts.find((account) => account.id === accountId);
  const currency = piggy?.currency_code ?? chosen?.currency_code ?? "BRL";
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
    if (error.code === "piggy_bank_name_taken") serverErrors.name = message;
    if (error.code === "invalid_amount") serverErrors.amount = message;
    if (error.code === "piggy_bank_account_invalid") serverErrors.account = message;

    setErrors(serverErrors);
    const first = FIELD_ORDER.find((field) => serverErrors[field]);
    if (first) document.getElementById(`piggy-${first}`)?.focus();
    if (!first || error.code === "validation_error") setFormError(message);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = { name: requiredError(name, t("piggy-banks.piggyBankFormDialog.informeONome")) };
    if (!editing && !accountId) found.account = t("piggy-banks.piggyBankFormDialog.escolhaAConta");

    let amountValue = "";
    if (amount.trim() === "") found.amount = t("piggy-banks.piggyBankFormDialog.informeOValorDaMeta");
    else {
      const parsed = parseMoneyInput(amount, places);
      if (!parsed.ok) found.amount = parsed.error;
      else if (/^0+(\.0+)?$/.test(parsed.value) || parsed.value.startsWith("-")) {
        found.amount = t("piggy-banks.piggyBankFormDialog.informeUmValorMaior");
      } else amountValue = parsed.value;
    }
    if (date && !DATE_PATTERN.test(date)) found.date = t("piggy-banks.piggyBankFormDialog.informeUmaData");

    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`piggy-${firstInvalid}`)?.focus();
      return;
    }

    try {
      if (!editing) {
        const body: PiggyBankCreate = {
          name: name.trim(),
          account_id: accountId,
          target_amount: amountValue,
          target_date: date || null,
        };
        await create.mutateAsync(body);
      } else {
        // Manda so o que mudou, para nao sobrescrever sem querer
        const body: PiggyBankUpdate = {};
        if (name.trim() !== piggy.name) body.name = name.trim();
        if (amountValue !== piggy.target_amount) body.target_amount = amountValue;
        if ((date || null) !== piggy.target_date) body.target_date = date || null;
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: piggy.id, body });
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
          <DialogTitle>{editing ? t("piggy-banks.piggyBankFormDialog.editarCofrinho") : t("piggy-banks.piggyBankFormDialog.novoCofrinho")}</DialogTitle>
          <DialogDescription>
            {editing
              ? t("piggy-banks.piggyBankFormDialog.aContaNaoPode")
              : t("piggy-banks.piggyBankFormDialog.separeUmValorDe")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="piggy-name" label={t("common.nome")} error={errors.name}>
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

          <FormField id="piggy-account" label={t("common.conta")} error={errors.account}>
            {(props) => (
              <Select
                {...props}
                value={accountId}
                disabled={editing}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  clearError("account");
                }}
              >
                {editing ? (
                  <option value={piggy.account_id}>{piggy.account_name}</option>
                ) : (
                  <>
                    <option value="">{t("common.escolha")}</option>
                    {assetAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                        {account.currency_code !== "BRL" ? ` - ${account.currency_code}` : ""}
                      </option>
                    ))}
                  </>
                )}
              </Select>
            )}
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="piggy-amount" label={t("piggy-banks.piggyBankFormDialog.valorDaMeta", { currency })} error={errors.amount}>
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

            <FormField id="piggy-date" label={t("piggy-banks.piggyBankFormDialog.dataAlvoOpcional")} error={errors.date}>
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
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("piggy-banks.piggyBankFormDialog.salvando") : editing ? t("piggy-banks.piggyBankFormDialog.salvar") : t("piggy-banks.piggyBankFormDialog.criarCofrinho")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

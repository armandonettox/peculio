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
import { MoneyInput } from "@/components/money-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { parseMoneyInput, placesOf } from "@/lib/money";
import { cn } from "@/lib/utils";
import { GOAL_COLORS, GOAL_ICON_NAMES, GOAL_TEMPLATES, GoalIconBadge, goalIconComponent, type GoalIconName, type GoalTemplateKey } from "./goal-icons";
import { useTranslation } from "react-i18next";

type Field = "name" | "account" | "amount" | "initial" | "date" | "description";
type Errors = Partial<Record<Field, string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_ORDER: Field[] = ["name", "account", "amount", "initial", "date", "description"];

// O backend usa ponto nos centavos; na tela mostramos virgula
const toInputText = (value: string) => value.replace(".", ",");

const SERVER_FIELDS: Record<string, Field> = {
  name: "name",
  account_id: "account",
  target_amount: "amount",
  target_date: "date",
  initial_amount: "initial",
  description: "description",
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
  const [initial, setInitial] = useState("");
  const [color, setColor] = useState<string | null>(piggy?.color ?? null);
  const [icon, setIcon] = useState<string | null>(piggy?.icon ?? null);
  const [description, setDescription] = useState(piggy?.description ?? "");
  // Criar comeca pela escolha de um modelo (como no Mobills); editar vai direto ao formulario
  const [step, setStep] = useState<"templates" | "form">(editing ? "form" : "templates");
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
    // O valor inicial e o primeiro "guardar": passa pelas mesmas regras de saldo e moeda
    if (error.code === "piggy_bank_not_enough_available") serverErrors.initial = message;

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

    let initialValue: string | null = null;
    if (!editing && initial.trim() !== "") {
      const parsed = parseMoneyInput(initial, places);
      if (!parsed.ok) found.initial = parsed.error;
      else if (parsed.value.startsWith("-")) found.initial = t("piggy-banks.piggyBankFormDialog.valorInicialNegativo");
      // Zero e o mesmo que nao informar
      else if (!/^0+(\.0+)?$/.test(parsed.value)) initialValue = parsed.value;
    }

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
          ...(color ? { color } : {}),
          ...(icon ? { icon: icon as GoalIconName } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(initialValue ? { initial_amount: initialValue } : {}),
        };
        await create.mutateAsync(body);
      } else {
        // Manda so o que mudou, para nao sobrescrever sem querer
        const body: PiggyBankUpdate = {};
        if (name.trim() !== piggy.name) body.name = name.trim();
        if (amountValue !== piggy.target_amount) body.target_amount = amountValue;
        if ((date || null) !== piggy.target_date) body.target_date = date || null;
        if (color !== (piggy.color ?? null)) body.color = color;
        if (icon !== (piggy.icon ?? null)) body.icon = icon as GoalIconName | null;
        if ((description.trim() || null) !== (piggy.description ?? null)) body.description = description.trim() || null;
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: piggy.id, body });
      }
      onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  function chooseTemplate(key: GoalTemplateKey) {
    const template = GOAL_TEMPLATES.find((item) => item.key === key)!;
    // "Objetivo personalizado" comeca em branco; os outros ja trazem nome, icone e cor
    if (key !== "custom") setName(t(`piggy-banks.templates.${key}`));
    setIcon(template.icon);
    setColor(template.color);
    setStep("form");
  }

  if (step === "templates") {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent fullOnMobile>
          <DialogHeader>
            <DialogTitle>{t("piggy-banks.piggyBankFormDialog.novoCofrinho")}</DialogTitle>
            <DialogDescription>{t("piggy-banks.templates.subtitle")}</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1">
            {GOAL_TEMPLATES.map((template) => (
              <li key={template.key}>
                <button
                  type="button"
                  onClick={() => chooseTemplate(template.key)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <GoalIconBadge icon={template.icon} color={template.color} className="size-9" />
                  {t(`piggy-banks.templates.${template.key}`)}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent fullOnMobile>
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
                <MoneyInput
                  {...props}
                  placeholder="0,00"
                  places={places}
                  value={amount}
                  onChange={(text) => {
                    setAmount(text);
                    clearError("amount");
                  }}
                />
              )}
            </FormField>

            {!editing && (
              <FormField id="piggy-initial" label={t("piggy-banks.piggyBankFormDialog.valorInicial", { currency })} error={errors.initial}>
                {(props) => (
                  <MoneyInput
                    {...props}
                    placeholder="0,00"
                    places={places}
                    value={initial}
                    onChange={(text) => {
                      setInitial(text);
                      clearError("initial");
                    }}
                  />
                )}
              </FormField>
            )}

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

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("piggy-banks.piggyBankFormDialog.cor")}</legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={color === null}
                aria-label={t("piggy-banks.piggyBankFormDialog.semCor")}
                onClick={() => setColor(null)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full border bg-card text-xs text-muted-foreground",
                  color === null && "ring-2 ring-primary-text ring-offset-2 ring-offset-background",
                )}
              >
                -
              </button>
              {GOAL_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={color === option}
                  aria-label={t("piggy-banks.piggyBankFormDialog.corNome", { color: option })}
                  onClick={() => setColor(option)}
                  className={cn("size-8 rounded-full", color === option && "ring-2 ring-primary-text ring-offset-2 ring-offset-background")}
                  style={{ backgroundColor: option }}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("piggy-banks.piggyBankFormDialog.icone")}</legend>
            <div className="flex flex-wrap gap-2">
              {GOAL_ICON_NAMES.map((name) => {
                const Icon = goalIconComponent(name);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={icon === name}
                    aria-label={t(`piggy-banks.icons.${name}`)}
                    onClick={() => setIcon(icon === name ? null : name)}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full border text-muted-foreground hover:bg-accent",
                      icon === name && "border-primary-text bg-accent text-primary-text ring-2 ring-primary-text ring-offset-2 ring-offset-background",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </fieldset>

          <FormField id="piggy-description" label={t("piggy-banks.piggyBankFormDialog.descricao")} error={errors.description}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                maxLength={300}
                placeholder={t("piggy-banks.piggyBankFormDialog.descricaoPlaceholder")}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  clearError("description");
                }}
              />
            )}
          </FormField>

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

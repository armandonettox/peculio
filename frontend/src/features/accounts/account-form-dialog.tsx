import { useState, type FormEvent } from "react";

import {
  useCreateAccount,
  useCurrencies,
  useUpdateAccount,
  type Account,
  type AccountCreate,
  type AccountUpdate,
} from "@/api/accounts";
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
import { Textarea } from "@/components/ui/textarea";
import { appToday } from "@/lib/dates";
import { parseMoneyInput, placesOf } from "@/lib/money";
import { DEFAULT_ROLE, kindLabel, roleLabel, ROLES_BY_KIND, type AccountKind } from "./labels";
import { useTranslation } from "react-i18next";

type Field = "name" | "opening" | "openingDate";
type Errors = Partial<Record<Field, string>>;
type Role = NonNullable<Account["role"]>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// O backend usa ponto nos centavos; na tela mostramos virgula
const toInputText = (value: string) => value.replace(".", ",");

const SERVER_FIELDS: Record<string, Field> = {
  name: "name",
  opening_balance: "opening",
  opening_balance_date: "openingDate",
};

type Props = {
  // Sem `account` o dialogo cria; com `account` edita
  account?: Account;
  onClose: () => void;
};

export function AccountFormDialog({ account, onClose }: Props) {
  const { t } = useTranslation();
  const editing = account !== undefined;
  const { user } = useAuth();
  const currencies = useCurrencies();
  const create = useCreateAccount();
  const update = useUpdateAccount();

  const [kind, setKind] = useState<AccountKind>(account?.type === "liability" ? "liability" : "asset");
  const [name, setName] = useState(account?.name ?? "");
  const [role, setRole] = useState<Role>(account?.role ?? DEFAULT_ROLE[kind]);
  const [currency, setCurrency] = useState(account?.currency_code ?? user?.default_currency ?? "BRL");
  // Conta criada sem saldo inicial nao tem data: o campo comeca vazio
  const hadOpening = account?.opening_balance_date != null;
  const initialOpening = hadOpening ? toInputText(account.opening_balance) : "";
  const [opening, setOpening] = useState(initialOpening);
  const [openingDate, setOpeningDate] = useState(account?.opening_balance_date ?? appToday());
  const [notes, setNotes] = useState(account?.notes ?? "");
  const [inEnvelopes, setInEnvelopes] = useState(account?.in_envelopes ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const placesMap = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const places = placesOf(currency, placesMap);
  const submitting = create.isPending || update.isPending;
  const openingLabel = kind === "liability" ? t("accounts.accountFormDialog.openingDebt") : t("accounts.accountFormDialog.openingBalance");

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function chooseKind(next: AccountKind) {
    setKind(next);
    setRole(DEFAULT_ROLE[next]);
  }

  function handleServerError(error: unknown) {
    const message = getErrorMessage(error);
    if (!(error instanceof ApiError)) return setFormError(message);

    const serverErrors: Errors = {};
    for (const item of error.fieldErrors) {
      const field = SERVER_FIELDS[item.field];
      if (field) serverErrors[field] = item.message;
    }
    if (error.code === "account_name_taken") serverErrors.name = message;
    if (error.code === "invalid_amount") serverErrors.opening = message;

    setErrors(serverErrors);
    const first = (["name", "opening", "openingDate"] as const).find((field) => serverErrors[field]);
    if (first) document.getElementById(`account-${first}`)?.focus();
    // Erro que nao e de um campo (moeda desconhecida, falha do servidor) vai no aviso do topo
    if (!first || error.code === "validation_error") setFormError(message);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = { name: requiredError(name, t("accounts.accountFormDialog.nameRequired")) };
    let openingValue: string | null = null;
    if (opening.trim()) {
      const parsed = parseMoneyInput(opening, places);
      if (!parsed.ok) found.opening = parsed.error;
      else if (kind === "liability" && parsed.value.startsWith("-")) {
        found.opening = t("accounts.accountFormDialog.debtPositive");
      } else openingValue = parsed.value;
      if (!found.opening && !DATE_PATTERN.test(openingDate)) found.openingDate = t("validation.dateInvalid");
    }
    setErrors(found);
    const firstInvalid = (["name", "opening", "openingDate"] as const).find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`account-${firstInvalid}`)?.focus();
      return;
    }

    try {
      if (!editing) {
        const body: AccountCreate = {
          name: name.trim(),
          type: kind,
          role,
          currency_code: currency,
          in_envelopes: inEnvelopes,
          notes: notes.trim() || null,
          // Zero nao cria transacao de saldo inicial no backend: e o mesmo que nao informar
          opening_balance: openingValue ?? "0",
          ...(openingValue !== null ? { opening_balance_date: openingDate } : {}),
        };
        await create.mutateAsync(body);
      } else {
        // Manda so o que mudou, para nao sobrescrever sem querer
        const body: AccountUpdate = {};
        if (name.trim() !== account.name) body.name = name.trim();
        if (role !== account.role) body.role = role;
        if (inEnvelopes !== account.in_envelopes) body.in_envelopes = inEnvelopes;
        if ((notes.trim() || null) !== account.notes) body.notes = notes.trim() || null;
        if (openingValue !== null) {
          if (opening !== initialOpening || openingDate !== account.opening_balance_date) {
            body.opening_balance = openingValue;
            body.opening_balance_date = openingDate;
          }
        } else if (hadOpening) {
          // Apagou o campo: remove o saldo inicial
          const zero = parseMoneyInput("0", places);
          body.opening_balance = zero.ok ? zero.value : "0.00";
        }
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: account.id, body });
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
          <DialogTitle>{editing ? t("accounts.accountFormDialog.editarConta") : t("accounts.accountFormDialog.novaConta")}</DialogTitle>
          <DialogDescription>
            {editing
              ? t("accounts.accountFormDialog.altereOsDadosDa")
              : t("accounts.accountFormDialog.cadastreUmaContaOnde")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          {!editing && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t("common.tipo")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["asset", "liability"] as const).map((option) => (
                  <label
                    key={option}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                  >
                    <input
                      type="radio"
                      name="account-kind"
                      value={option}
                      checked={kind === option}
                      onChange={() => chooseKind(option)}
                      className="accent-[var(--primary)]"
                    />
                    {kindLabel(option)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <FormField id="account-name" label={t("common.nome")} error={errors.name}>
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
            <FormField id="account-role" label={t("accounts.accountFormDialog.categoriaDaConta")}>
              {(props) => (
                <Select {...props} value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  {ROLES_BY_KIND[kind].map((option) => (
                    <option key={option} value={option}>
                      {roleLabel(option)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField id="account-currency" label={t("common.moeda")}>
              {(props) => (
                <Select
                  {...props}
                  value={currency}
                  disabled={editing}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {/* Enquanto a lista carrega, mostra so a moeda atual */}
                  {(currencies.data ?? [{ code: currency, name: currency }]).map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} - {option.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>

          <FormField
            id="account-opening"
            label={openingLabel}
            error={errors.opening}
            hint={
              kind === "liability"
                ? t("accounts.accountFormDialog.valorQueVoceAinda")
                : t("accounts.accountFormDialog.quantoVoceTemHoje")
            }
          >
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={opening}
                onChange={(event) => {
                  setOpening(event.target.value);
                  clearError("opening");
                }}
              />
            )}
          </FormField>

          {opening.trim() !== "" && (
            <FormField id="account-openingDate" label={t("accounts.accountFormDialog.dataDoSaldo")} error={errors.openingDate}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={openingDate}
                  onChange={(event) => {
                    setOpeningDate(event.target.value);
                    clearError("openingDate");
                  }}
                />
              )}
            </FormField>
          )}

          <FormField id="account-notes" label={t("accounts.accountFormDialog.notas")}>
            {(props) => <Textarea {...props} value={notes} onChange={(event) => setNotes(event.target.value)} />}
          </FormField>

          {kind === "asset" && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={inEnvelopes}
                onChange={(event) => setInEnvelopes(event.target.checked)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span>
                {t("accounts.accountFormDialog.inEnvelopes")}
                <span className="block text-xs text-muted-foreground">
                  {t("accounts.accountFormDialog.oDinheiroDestaConta")}
                </span>
              </span>
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("accounts.accountFormDialog.salvando") : editing ? t("accounts.accountFormDialog.salvar") : t("accounts.accountFormDialog.criarConta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

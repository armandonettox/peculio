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
import { DEFAULT_ROLE, KIND_LABELS, ROLE_LABELS, ROLES_BY_KIND, type AccountKind } from "./labels";

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
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const placesMap = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const places = placesOf(currency, placesMap);
  const submitting = create.isPending || update.isPending;
  const openingLabel = kind === "liability" ? "Quanto você deve" : "Saldo inicial";

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

    const found: Errors = { name: requiredError(name, "Informe o nome da conta.") };
    let openingValue: string | null = null;
    if (opening.trim()) {
      const parsed = parseMoneyInput(opening, places);
      if (!parsed.ok) found.opening = parsed.error;
      else if (kind === "liability" && parsed.value.startsWith("-")) {
        found.opening = "Informe quanto você deve como um valor positivo.";
      } else openingValue = parsed.value;
      if (!found.opening && !DATE_PATTERN.test(openingDate)) found.openingDate = "Informe uma data válida.";
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
          // O interruptor "Entra nos envelopes" chega com a tela de envelopes; ate la vale o padrao do servidor
          in_envelopes: true,
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
          <DialogTitle>{editing ? "Editar conta" : "Nova conta"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Altere os dados da conta. O tipo e a moeda não podem mudar."
              : "Cadastre uma conta (onde você guarda dinheiro) ou uma dívida (o que você deve)."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          {!editing && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Tipo</legend>
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
                    {KIND_LABELS[option]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <FormField id="account-name" label="Nome" error={errors.name}>
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
            <FormField id="account-role" label="Categoria da conta">
              {(props) => (
                <Select {...props} value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  {ROLES_BY_KIND[kind].map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField id="account-currency" label="Moeda">
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
                ? "Valor que você ainda deve hoje. Deixe em branco se não quiser informar."
                : "Quanto você tem hoje nesta conta. Deixe em branco para começar do zero."
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
            <FormField id="account-openingDate" label="Data do saldo" error={errors.openingDate}>
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

          <FormField id="account-notes" label="Notas">
            {(props) => <Textarea {...props} value={notes} onChange={(event) => setNotes(event.target.value)} />}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : editing ? "Salvar" : "Criar conta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

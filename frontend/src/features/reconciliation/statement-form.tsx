import { useState, type FormEvent } from "react";

import { useCurrencies, type Account } from "@/api/accounts";
import type { Statement } from "@/api/reconciliation";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { appToday } from "@/lib/dates";
import { parseMoneyInput, placesOf } from "@/lib/money";

type Field = "account" | "balance" | "date";
type Errors = Partial<Record<Field, string>>;

type Props = {
  accounts: Account[];
  // Chamado com o extrato lido; `null` quando a pessoa muda de conta e o que estava na tela deixa de valer
  onApply: (statement: Statement | null) => void;
};

/** O que o extrato do banco mostra: a conta, o saldo e a data dele. */
export function StatementForm({ accounts, onApply }: Props) {
  const currencies = useCurrencies();
  const today = appToday();
  // Uma conta so: nao ha o que escolher
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0].id : "");
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(today);
  const [errors, setErrors] = useState<Errors>({});

  const account = accounts.find((item) => item.id === accountId);
  const placesMap = Object.fromEntries((currencies.data ?? []).map((currency) => [currency.code, currency.decimal_places]));
  const places = placesOf(account?.currency_code ?? "BRL", placesMap);

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const found: Errors = {};
    if (!accountId) found.account = "Escolha a conta.";
    const parsed = parseMoneyInput(balance, places);
    if (!parsed.ok) found.balance = parsed.error;
    if (!date) found.date = "Informe a data do extrato.";
    else if (date > today) found.date = "A data do extrato não pode ser no futuro.";

    setErrors(found);
    const firstInvalid = (["account", "balance", "date"] as const).find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`statement-${firstInvalid}`)?.focus();
      return;
    }
    if (parsed.ok) onApply({ accountId, balance: parsed.value, date });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid max-w-3xl gap-4 sm:grid-cols-3">
      <FormField id="statement-account" label="Conta" error={errors.account}>
        {(props) => (
          <Select
            {...props}
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
              clearError("account");
              onApply(null);
            }}
          >
            <option value="">Escolha a conta</option>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="statement-balance" label={`Saldo do extrato${account ? ` (${account.currency_code})` : ""}`} error={errors.balance}>
        {(props) => (
          <Input
            {...props}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={balance}
            onChange={(event) => {
              setBalance(event.target.value);
              clearError("balance");
            }}
          />
        )}
      </FormField>

      <FormField id="statement-date" label="Data do extrato" error={errors.date}>
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

      <div className="sm:col-span-3">
        <Button type="submit">Conferir</Button>
      </div>
    </form>
  );
}

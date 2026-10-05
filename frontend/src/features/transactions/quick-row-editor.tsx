import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Account } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import type { Category } from "@/api/labels";
import { useCounterparties, type TransactionCreate } from "@/api/transactions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import type { FormContext, FormState } from "./form-model";
import {
  buildQuickPayload,
  firstErrorColumn,
  hasQuickErrors,
  isBlankRow,
  kindHint,
  kindOfAmount,
  rowChanged,
  validateQuick,
  type QuickColumn,
  type QuickErrors,
  type QuickRow,
} from "./quick-row";

type Props = {
  mode: "new" | "edit";
  initial: QuickRow;
  // O resto do lancamento (tags, orcamento, notas...), que a linha nao mostra mas precisa devolver ao salvar
  base: FormState;
  ctx: FormContext;
  categories: Category[];
  // Em que campo o foco comeca
  focusColumn?: QuickColumn;
  save: (payload: TransactionCreate) => Promise<unknown>;
  // Salvou (ou nao havia o que salvar). `closeAfter`: fechar a linha; senao, uma nova linha de entrada segue aberta.
  onDone: (saved: QuickRow, closeAfter: boolean) => void;
  onCancel: () => void;
};

const LABELS: Record<QuickColumn, string> = {
  date: "Data",
  description: "Descrição",
  counterparty: "Contraparte",
  account: "Conta",
  category: "Categoria",
  amount: "Valor",
};

type Field = HTMLInputElement | HTMLSelectElement;

/**
 * A linha de entrada (nova) ou de edicao (lancamento existente) da tabela. Grava a linha inteira de uma vez: Enter
 * grava, Ctrl+Enter grava e fecha, Esc cancela, e Tab anda de campo em campo. O servidor valida tudo de novo, e o erro
 * dele aparece embaixo da linha sem fecha-la.
 */
export function QuickRowEditor({ mode, initial, base, ctx, categories, focusColumn, save, onDone, onCancel }: Props) {
  const [row, setRow] = useState(initial);
  const [errors, setErrors] = useState<QuickErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = useRef<Partial<Record<QuickColumn, Field | null>>>({});

  const searchType = kindOfAmount(row.amount) === "withdrawal" ? "expense" : "revenue";
  const search = useDebouncedValue(row.counterpartyName.trim(), 250);
  const suggestions = useCounterparties(searchType, search);
  const hint = kindHint(row.amount);

  useEffect(() => {
    fields.current[focusColumn ?? (mode === "new" ? "date" : "description")]?.focus();
    // So ao abrir: depois disso quem decide o foco e a pessoa
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(change: Partial<QuickRow>, column?: keyof QuickErrors) {
    setRow((current) => ({ ...current, ...change }));
    if (column && errors[column]) setErrors((current) => ({ ...current, [column]: undefined }));
    setServerError(null);
  }

  async function submit(closeAfter: boolean) {
    if (busy) return;
    if (mode === "new" && isBlankRow(row)) {
      if (closeAfter) onCancel();
      return;
    }
    // Sem mudanca nao ha o que mandar ao servidor
    if (mode === "edit" && !rowChanged(row, initial)) return onDone(row, true);

    const found = validateQuick(row, base, ctx);
    setErrors(found);
    if (hasQuickErrors(found)) {
      const column = firstErrorColumn(found);
      if (column) fields.current[column]?.focus();
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      await save(buildQuickPayload(row, base, ctx));
    } catch (failure) {
      setServerError(getErrorMessage(failure));
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone(row, closeAfter || mode === "edit");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement;
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onCancel();
      return;
    }
    // Enter nos campos grava; num botao da linha, e do botao
    if (event.key === "Enter" && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      event.preventDefault();
      void submit(event.ctrlKey || event.metaKey);
    }
  }

  const errorId = (column: keyof QuickErrors) => `quick-${mode}-${column}-error`;
  const fieldProps = (column: QuickColumn) => ({
    "aria-label": LABELS[column],
    "aria-invalid": Boolean(errors[column as keyof QuickErrors]),
    "aria-describedby": errors[column as keyof QuickErrors] ? errorId(column as keyof QuickErrors) : undefined,
    disabled: busy,
  });
  const errorText = (column: keyof QuickErrors) =>
    errors[column] ? (
      <p id={errorId(column)} className="mt-1 text-xs text-destructive">
        {errors[column]}
      </p>
    ) : null;

  // Contas ativas, mais a que o lancamento ja usa (pode ter sido arquivada)
  const accounts: Account[] = ctx.accounts.filter((account) => account.active || account.id === row.accountId);
  const datalistId = `quick-${mode}-counterparties`;

  return (
    <>
      <tr
        aria-label={mode === "new" ? "Novo lançamento" : `Editando ${initial.description}`}
        onKeyDown={handleKeyDown}
        className="bg-accent/40 align-top"
      >
        {/* Fica sob a coluna de marcar da tabela */}
        <td />
        <td className="px-2 py-2">
          <Input
            {...fieldProps("date")}
            ref={(element) => {
              fields.current.date = element;
            }}
            type="date"
            value={row.date}
            onChange={(event) => patch({ date: event.target.value }, "date")}
            className="min-w-36"
          />
          {errorText("date")}
        </td>
        <td className="px-2 py-2">
          <Input
            {...fieldProps("description")}
            ref={(element) => {
              fields.current.description = element;
            }}
            autoComplete="off"
            value={row.description}
            onChange={(event) => patch({ description: event.target.value }, "description")}
            className="min-w-40"
          />
          {errorText("description")}
        </td>
        <td className="px-2 py-2">
          <Input
            {...fieldProps("counterparty")}
            ref={(element) => {
              fields.current.counterparty = element;
            }}
            autoComplete="off"
            list={datalistId}
            value={row.counterpartyName}
            onChange={(event) => patch({ counterpartyName: event.target.value }, "counterparty")}
            className="min-w-36"
          />
          <datalist id={datalistId}>
            {(suggestions.data ?? []).map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
          {errorText("counterparty")}
        </td>
        <td className="px-2 py-2">
          <Select
            {...fieldProps("account")}
            ref={(element) => {
              fields.current.account = element;
            }}
            value={row.accountId}
            onChange={(event) => patch({ accountId: event.target.value }, "account")}
            className="min-w-32"
          >
            <option value="">Escolha</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.active ? "" : " (arquivada)"}
              </option>
            ))}
          </Select>
          {errorText("account")}
        </td>
        <td className="px-2 py-2">
          <Select
            {...fieldProps("category")}
            ref={(element) => {
              fields.current.category = element;
            }}
            value={row.categoryId}
            onChange={(event) => patch({ categoryId: event.target.value })}
            className="min-w-32"
          >
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </td>
        <td className="px-2 py-2">
          <Input
            {...fieldProps("amount")}
            ref={(element) => {
              fields.current.amount = element;
            }}
            inputMode="decimal"
            autoComplete="off"
            placeholder="-0,00"
            value={row.amount}
            onChange={(event) => patch({ amount: event.target.value }, "amount")}
            className="min-w-28 text-right tabular-nums"
          />
          <p className={cn("mt-1 text-right text-xs text-muted-foreground", !hint && "invisible")} aria-live="polite">
            {hint ?? "Saída"}
          </p>
          {errorText("amount")}
        </td>
        <td className="px-2 py-2">
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" onClick={() => void submit(false)} disabled={busy}>
              {busy ? "Salvando..." : mode === "new" ? "Adicionar" : "Salvar"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
              Cancelar
            </Button>
          </div>
        </td>
      </tr>
      {serverError && (
        <tr>
          <td colSpan={8} role="alert" className="bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {serverError}
          </td>
        </tr>
      )}
    </>
  );
}

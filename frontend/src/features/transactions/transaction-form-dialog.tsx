import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { useAccounts, useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useCategories, useTags, type Tag } from "@/api/labels";
import {
  useCounterparties,
  useCreateTransaction,
  useUpdateTransaction,
  type Transaction,
} from "@/api/transactions";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildPayload,
  canSplit,
  emptyForm,
  emptySplit,
  foreignAccount,
  formFromTransaction,
  formatRemainder,
  hasErrors,
  isLiability,
  remainder,
  validateForm,
  accountOf,
  type FormContext,
  type FormErrors,
  type FormState,
  type Kind,
  type SplitDraft,
} from "./form-model";

const KIND_LABELS: Record<Kind, string> = {
  withdrawal: "Saída",
  deposit: "Entrada",
  transfer: "Transferência",
};

type Props = {
  // Sem `transaction` o dialogo cria; com `transaction` edita
  transaction?: Transaction;
  onClose: () => void;
};

// Escolha de tags: botoes que ligam e desligam, com aria-pressed
function TagPicker({
  tags,
  selected,
  onChange,
  label,
}: {
  tags: Tag[];
  selected: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  if (tags.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {tags.map((tag) => {
        const on = selected.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((id) => id !== tag.id) : [...selected, tag.id])}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-accent font-medium" : "text-muted-foreground hover:bg-accent",
            )}
          >
            #{tag.name}
          </button>
        );
      })}
    </div>
  );
}

export function TransactionFormDialog({ transaction, onClose }: Props) {
  const editing = transaction !== undefined;
  const accountsQuery = useAccounts({ includeArchived: true });
  const currencies = useCurrencies();
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  const create = useCreateTransaction();
  const update = useUpdateTransaction();

  const ready = accountsQuery.data !== undefined && currencies.data !== undefined;
  const ctx: FormContext = useMemo(
    () => ({
      accounts: accountsQuery.data ?? [],
      places: Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places])),
    }),
    [accountsQuery.data, currencies.data],
  );

  // O estado inicial depende das contas; o corpo so e montado quando elas chegam
  const loadError = accountsQuery.isError || currencies.isError ? getErrorMessage(accountsQuery.error ?? currencies.error) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && !update.isPending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
          <DialogDescription>
            {editing ? "Altere os dados do lançamento." : "Registre uma saída, uma entrada ou uma transferência."}
          </DialogDescription>
        </DialogHeader>

        {loadError && <Alert variant="destructive">{loadError}</Alert>}
        {!ready && !loadError && (
          <p role="status" className="text-sm text-muted-foreground">
            Carregando...
          </p>
        )}
        {ready && (
          <FormBody
            ctx={ctx}
            transaction={transaction}
            categories={categories.data?.items ?? []}
            tags={tags.data?.items ?? []}
            create={create}
            update={update}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type BodyProps = {
  ctx: FormContext;
  transaction?: Transaction;
  categories: { id: string; name: string }[];
  tags: Tag[];
  create: ReturnType<typeof useCreateTransaction>;
  update: ReturnType<typeof useUpdateTransaction>;
  onClose: () => void;
};

function FormBody({ ctx, transaction, categories, tags, create, update, onClose }: BodyProps) {
  const editing = transaction !== undefined;

  // Calculado uma vez, na abertura: o formulario nao deve ser refeito quando a lista recarrega
  const [initial] = useState(() => (transaction ? formFromTransaction(transaction, ctx) : null));
  const [state, setState] = useState<FormState>(() =>
    initial?.ok ? initial.state : emptyForm(ctx),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submitting = create.isPending || update.isPending;
  const account = accountOf(ctx, state.accountId);
  const currency = account?.currency_code ?? "BRL";
  const other = foreignAccount(state, ctx);
  const splittable = canSplit(state, ctx);
  const left = remainder(state, ctx);

  const searchType = state.kind === "withdrawal" ? "expense" : "revenue";
  const usesNameSearch = state.kind !== "transfer" && !state.ownCounterparty;
  const suggestions = useCounterparties(searchType, state.counterpartyName.trim(), { enabled: usesNameSearch });

  // Contas ativas, mais a conta do lancamento caso ela tenha sido arquivada
  const selectable = ctx.accounts.filter((a) => a.active || a.id === state.accountId || a.id === state.counterpartyAccountId);
  const debts = selectable.filter(isLiability);

  if (initial && !initial.ok) {
    return (
      <>
        <Alert variant="destructive">{initial.reason}</Alert>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </DialogFooter>
      </>
    );
  }

  function patch(changes: Partial<FormState>, ...cleared: (keyof FormErrors)[]) {
    setState((current) => ({ ...current, ...changes }));
    if (cleared.length > 0) {
      setErrors((current) => {
        const next = { ...current };
        for (const key of cleared) delete next[key];
        return next;
      });
    }
  }

  function chooseKind(kind: Kind) {
    // Trocar o tipo muda o sentido da outra ponta: limpa o que nao vale mais
    patch(
      {
        kind,
        ownCounterparty: false,
        counterpartyName: "",
        counterpartyAccountId: "",
        foreignAmount: "",
        splits: kind === "transfer" ? null : state.splits,
      },
      "counterparty",
      "foreignAmount",
    );
  }

  function changeSplit(key: string, changes: Partial<SplitDraft>) {
    setState((current) => ({
      ...current,
      splits: current.splits?.map((row) => (row.key === key ? { ...row, ...changes } : row)) ?? null,
    }));
    setErrors((current) => ({ ...current, splitTotal: undefined, splits: undefined }));
  }

  function startSplit() {
    // O valor digitado vira o total; a primeira linha ja leva a descricao e a categoria
    setState((current) => ({
      ...current,
      splits: [
        emptySplit({
          description: current.description,
          amount: current.amount,
          categoryId: current.categoryId,
          tagIds: current.tagIds,
        }),
      ],
    }));
  }

  function stopSplit() {
    setState((current) => {
      const [first] = current.splits ?? [];
      return {
        ...current,
        splits: null,
        description: current.description || first?.description || "",
        categoryId: first?.categoryId ?? current.categoryId,
        tagIds: first?.tagIds ?? current.tagIds,
      };
    });
    setErrors((current) => ({ ...current, splitTotal: undefined, splits: undefined }));
  }

  function handleServerError(error: unknown) {
    const message = getErrorMessage(error);
    if (error instanceof ApiError && (error.code === "invalid_amount" || error.code === "currency_mismatch")) {
      setErrors({ amount: message });
      document.getElementById("tx-amount")?.focus();
      return;
    }
    setFormError(message);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found = validateForm(state, ctx);
    setErrors(found);
    if (hasErrors(found)) {
      const order: [keyof FormErrors, string][] = [
        ["date", "tx-date"],
        ["accountId", "tx-account"],
        ["description", "tx-description"],
        ["counterparty", "tx-counterparty"],
        ["amount", "tx-amount"],
        ["foreignAmount", "tx-foreign-amount"],
      ];
      const first = order.find(([field]) => found[field]);
      if (first) document.getElementById(first[1])?.focus();
      return;
    }

    try {
      const body = buildPayload(state, ctx);
      if (transaction) await update.mutateAsync({ id: transaction.id, body });
      else await create.mutateAsync(body);
      onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  const counterpartyLabel =
    state.kind === "transfer"
      ? "Para a conta"
      : state.ownCounterparty
        ? "Dívida"
        : state.kind === "withdrawal"
          ? "Para quem"
          : "De quem";

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert variant="destructive">{formError}</Alert>}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Tipo</legend>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(KIND_LABELS) as Kind[]).map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center justify-center gap-2 rounded-md border px-2 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <input
                type="radio"
                name="tx-kind"
                value={option}
                checked={state.kind === option}
                onChange={() => chooseKind(option)}
                className="accent-[var(--primary)]"
              />
              {KIND_LABELS[option]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="tx-date" label="Data" error={errors.date}>
          {(props) => (
            <Input {...props} type="date" value={state.date} onChange={(e) => patch({ date: e.target.value }, "date")} />
          )}
        </FormField>

        <FormField id="tx-account" label={state.kind === "deposit" ? "Conta que recebe" : "Conta"} error={errors.accountId}>
          {(props) => (
            <Select
              {...props}
              value={state.accountId}
              onChange={(e) => patch({ accountId: e.target.value, foreignAmount: "" }, "accountId", "foreignAmount")}
            >
              <option value="">Escolha...</option>
              {selectable.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.active ? "" : " (arquivada)"}
                  {option.currency_code !== "BRL" ? ` - ${option.currency_code}` : ""}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <FormField
        id="tx-description"
        label={state.splits ? "Título (opcional)" : "Descrição"}
        error={errors.description}
      >
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            value={state.description}
            onChange={(e) => patch({ description: e.target.value }, "description")}
          />
        )}
      </FormField>

      {/* A outra ponta */}
      {state.kind === "transfer" ? (
        <FormField id="tx-counterparty" label={counterpartyLabel} error={errors.counterparty}>
          {(props) => (
            <Select
              {...props}
              value={state.counterpartyAccountId}
              onChange={(e) =>
                patch({ counterpartyAccountId: e.target.value, foreignAmount: "" }, "counterparty", "foreignAmount")
              }
            >
              <option value="">Escolha...</option>
              {selectable
                .filter((a) => a.id !== state.accountId)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                    {option.currency_code !== "BRL" ? ` - ${option.currency_code}` : ""}
                  </option>
                ))}
            </Select>
          )}
        </FormField>
      ) : state.ownCounterparty ? (
        <div className="flex flex-col gap-2">
          <FormField id="tx-counterparty" label={counterpartyLabel} error={errors.counterparty}>
            {(props) => (
              <Select
                {...props}
                value={state.counterpartyAccountId}
                onChange={(e) =>
                  patch({ counterpartyAccountId: e.target.value, foreignAmount: "" }, "counterparty", "foreignAmount")
                }
              >
                <option value="">Escolha...</option>
                {debts.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                    {option.currency_code !== "BRL" ? ` - ${option.currency_code}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <button
            type="button"
            className="self-start text-xs text-primary-text underline underline-offset-2"
            onClick={() =>
              patch({ ownCounterparty: false, counterpartyAccountId: "", foreignAmount: "" }, "counterparty", "foreignAmount")
            }
          >
            {state.kind === "withdrawal" ? "Pagar para um nome" : "Receber de um nome"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <FormField id="tx-counterparty" label={counterpartyLabel} error={errors.counterparty}>
            {(props) => (
              <>
                <Input
                  {...props}
                  autoComplete="off"
                  list="tx-counterparty-options"
                  value={state.counterpartyName}
                  onChange={(e) => patch({ counterpartyName: e.target.value }, "counterparty")}
                />
                <datalist id="tx-counterparty-options">
                  {(suggestions.data ?? []).map((item) => (
                    <option key={item.id} value={item.name} />
                  ))}
                </datalist>
              </>
            )}
          </FormField>
          {debts.length > 0 && (
            <button
              type="button"
              className="self-start text-xs text-primary-text underline underline-offset-2"
              onClick={() => patch({ ownCounterparty: true, counterpartyName: "" }, "counterparty")}
            >
              {state.kind === "withdrawal" ? "Pagar uma dívida" : "Receber de uma dívida"}
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="tx-amount"
          label={state.splits ? `Valor total (${currency})` : `Valor (${currency})`}
          error={errors.amount}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={state.amount}
              onChange={(e) => patch({ amount: e.target.value }, "amount", "splitTotal")}
            />
          )}
        </FormField>

        {other && (
          <FormField id="tx-foreign-amount" label={`Valor que chega em ${other.currency_code}`} error={errors.foreignAmount}>
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={state.foreignAmount}
                onChange={(e) => patch({ foreignAmount: e.target.value }, "foreignAmount")}
              />
            )}
          </FormField>
        )}
      </div>

      {/* Linhas da divisao, ou categoria e tags de um lancamento so */}
      {state.splits ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Divisão</h3>
            <Button type="button" variant="ghost" size="sm" onClick={stopSplit}>
              Desfazer divisão
            </Button>
          </div>

          {state.splits.map((row, index) => {
            const rowErrors = errors.splits?.[row.key];
            return (
              <div key={row.key} className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Linha {index + 1}</p>
                  {state.splits && state.splits.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remover linha ${index + 1}`}
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          splits: current.splits?.filter((item) => item.key !== row.key) ?? null,
                        }))
                      }
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                  <FormField id={`${row.key}-description`} label={`Descrição da linha ${index + 1}`} error={rowErrors?.description}>
                    {(props) => (
                      <Input
                        {...props}
                        autoComplete="off"
                        value={row.description}
                        onChange={(e) => changeSplit(row.key, { description: e.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField id={`${row.key}-amount`} label={`Valor da linha ${index + 1}`} error={rowErrors?.amount}>
                    {(props) => (
                      <Input
                        {...props}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0,00"
                        value={row.amount}
                        onChange={(e) => changeSplit(row.key, { amount: e.target.value })}
                      />
                    )}
                  </FormField>
                </div>
                <FormField id={`${row.key}-category`} label={`Categoria da linha ${index + 1}`}>
                  {(props) => (
                    <Select
                      {...props}
                      value={row.categoryId}
                      onChange={(e) => changeSplit(row.key, { categoryId: e.target.value })}
                    >
                      <option value="">Sem categoria</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <TagPicker
                  tags={tags}
                  selected={row.tagIds}
                  label={`Tags da linha ${index + 1}`}
                  onChange={(next) => changeSplit(row.key, { tagIds: next })}
                />
              </div>
            );
          })}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setState((current) => ({ ...current, splits: [...(current.splits ?? []), emptySplit()] }))
            }
          >
            <Plus />
            Adicionar linha
          </Button>

          {errors.splitTotal ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.splitTotal}
            </p>
          ) : (
            left !== null && (
              <p role="status" className="text-sm text-muted-foreground">
                {/^-?0+(\.0+)?$/.test(left)
                  ? "Tudo distribuído."
                  : `${left.startsWith("-") ? "As linhas passam do total em" : "Falta distribuir"} ${formatRemainder(left, currency)}`}
              </p>
            )
          )}
        </div>
      ) : (
        <>
          <FormField id="tx-category" label="Categoria">
            {(props) => (
              <Select {...props} value={state.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <TagPicker tags={tags} selected={state.tagIds} label="Tags" onChange={(next) => patch({ tagIds: next })} />
          {splittable && (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={startSplit}>
              Dividir lançamento
            </Button>
          )}
        </>
      )}

      <FormField id="tx-notes" label="Notas">
        {(props) => <Textarea {...props} value={state.notes} onChange={(e) => patch({ notes: e.target.value })} />}
      </FormField>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Salvando..." : editing ? "Salvar" : "Criar lançamento"}
        </Button>
      </DialogFooter>
    </form>
  );
}

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { useAccounts, useCurrencies } from "@/api/accounts";
import { useBills, type Bill } from "@/api/bills";
import {
  useCreateRecurrence,
  useUpdateRecurrence,
  type Recurrence,
  type RecurrenceFrequency,
} from "@/api/recurrences";
import { useBudgets, type Budget } from "@/api/budgets";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useCategories, useTags, type Category, type Tag } from "@/api/labels";
import {
  useCounterparties,
  useCreateTransaction,
  useUpdateTransaction,
  type Transaction,
  type TransactionCreate,
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
  originalAllowed,
  formFromTemplate,
  formFromTransaction,
  splitRemainderText,
  hasErrors,
  isLiability,
  remainder,
  validateForm,
  accountOf,
  budgetAllowed,
  installmentsAllowed,
  type FormContext,
  type FormErrors,
  type FormState,
  type Kind,
  type SplitDraft,
} from "./form-model";

import { FREQUENCIES, frequencyLabel } from "@/features/recurrences/presentation";
import { appToday } from "@/lib/dates";
import { useTranslation } from "react-i18next";

const KIND_OPTIONS: Kind[] = ["withdrawal", "deposit", "transfer"];

type Props = {
  // Sem `transaction` o dialogo cria; com `transaction` edita
  transaction?: Transaction;
  // Modo recorrente: o mesmo formulario, mais nome, frequencia e fim. Com `recurrence` edita.
  repeating?: boolean;
  recurrence?: Recurrence;
  // Abre ja preenchido com um lancamento novo (ex: "marcar fatura como paga"), sem repetir
  initialTemplate?: { template: TransactionCreate; date: string };
  onClose: () => void;
};

type EndMode = "never" | "date" | "count";
type RepeatErrors = { name?: string; endDate?: string; endCount?: string };

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
              on ? "border-primary bg-accent font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            #{tag.name}
          </button>
        );
      })}
    </div>
  );
}

export function TransactionFormDialog({ transaction, repeating = false, recurrence, initialTemplate, onClose }: Props) {
  const { t } = useTranslation();
  const recurring = repeating || recurrence !== undefined;
  const editing = transaction !== undefined || recurrence !== undefined;
  const accountsQuery = useAccounts({ includeArchived: true });
  const currencies = useCurrencies();
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  // Todos, inclusive arquivados: editar um lancamento ligado a um orcamento arquivado precisa mostrar o nome dele
  const budgets = useBudgets({ activeOnly: false });
  const bills = useBills({ activeOnly: false });
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const createRecurrence = useCreateRecurrence();
  const updateRecurrence = useUpdateRecurrence();
  const busy = create.isPending || update.isPending || createRecurrence.isPending || updateRecurrence.isPending;

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
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {recurring ? (editing ? t("transactions.transactionFormDialog.editarRecorrente") : t("transactions.transactionFormDialog.novaRecorrente")) : editing ? t("transactions.transactionFormDialog.editarLancamento") : t("transactions.transactionFormDialog.novoLancamento")}
          </DialogTitle>
          <DialogDescription>
            {recurring
              ? t("transactions.transactionFormDialog.umLancamentoQueSe")
              : editing
                ? t("transactions.transactionFormDialog.altereOsDadosDo")
                : t("transactions.transactionFormDialog.registreUmaSaidaUma")}
          </DialogDescription>
        </DialogHeader>

        {loadError && <Alert variant="destructive">{loadError}</Alert>}
        {!ready && !loadError && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("common.carregando")}
          </p>
        )}
        {ready && (
          <FormBody
            ctx={ctx}
            currencies={currencies.data ?? []}
            transaction={transaction}
            recurrence={recurrence}
            recurring={recurring}
            categories={categories.data?.items ?? []}
            tags={tags.data?.items ?? []}
            budgets={budgets.data ?? []}
            bills={bills.data ?? []}
            create={create}
            update={update}
            createRecurrence={createRecurrence}
            updateRecurrence={updateRecurrence}
            initialTemplate={initialTemplate}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type BodyProps = {
  ctx: FormContext;
  // Moedas conhecidas, para escolher a moeda do valor original
  currencies: { code: string; name: string }[];
  transaction?: Transaction;
  recurrence?: Recurrence;
  recurring: boolean;
  categories: Category[];
  tags: Tag[];
  budgets: Budget[];
  bills: Bill[];
  create: ReturnType<typeof useCreateTransaction>;
  update: ReturnType<typeof useUpdateTransaction>;
  createRecurrence: ReturnType<typeof useCreateRecurrence>;
  updateRecurrence: ReturnType<typeof useUpdateRecurrence>;
  initialTemplate?: { template: TransactionCreate; date: string };
  onClose: () => void;
};

function FormBody({
  ctx,
  currencies,
  transaction,
  recurrence,
  recurring,
  categories,
  tags,
  budgets,
  bills,
  create,
  update,
  createRecurrence,
  updateRecurrence,
  initialTemplate,
  onClose,
}: BodyProps) {
  const { t } = useTranslation();
  const editing = transaction !== undefined || recurrence !== undefined;

  // Calculado uma vez, na abertura: o formulario nao deve ser refeito quando a lista recarrega
  const [initial] = useState(() => {
    if (recurrence) return formFromTemplate(recurrence.template, ctx, recurrence.first_date);
    if (transaction) return formFromTransaction(transaction, ctx);
    if (initialTemplate) return formFromTemplate(initialTemplate.template, ctx, initialTemplate.date);
    return null;
  });
  const [state, setState] = useState<FormState>(() =>
    initial?.ok ? initial.state : emptyForm(ctx),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  // So no modo recorrente
  const [name, setName] = useState(recurrence?.name ?? "");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(recurrence?.frequency ?? "monthly");
  const [endMode, setEndMode] = useState<EndMode>(
    recurrence?.end_date ? "date" : recurrence?.max_occurrences ? "count" : "never",
  );
  const [endDate, setEndDate] = useState(recurrence?.end_date ?? "");
  const [endCount, setEndCount] = useState(recurrence?.max_occurrences ? String(recurrence.max_occurrences) : "");
  const [repeatErrors, setRepeatErrors] = useState<RepeatErrors>({});

  const submitting =
    create.isPending || update.isPending || createRecurrence.isPending || updateRecurrence.isPending;
  const account = accountOf(ctx, state.accountId);
  const currency = account?.currency_code ?? "BRL";
  const other = foreignAccount(state, ctx);
  // Valor original (informativo): outra moeda que nao a da conta. A escolhida aparece mesmo que a lista nao a traga.
  const originalCurrencies = currencies.filter((item) => item.code !== currency);
  const originalChosen = state.originalCurrency !== "" && state.originalCurrency !== currency;
  const splittable = canSplit(state, ctx);
  const left = remainder(state, ctx);

  // Orcamentos da moeda da conta; um arquivado so aparece se ja for o escolhido
  const budgetOptions = (selectedId: string) =>
    budgets.filter((budget) => budget.currency_code === currency && (budget.active || budget.id === selectedId));
  const clearBudgets = (rows: SplitDraft[] | null) =>
    rows?.map((row) => ({ ...row, budgetId: "", billId: "" })) ?? null;
  // Contas a pagar da moeda da conta; uma arquivada so aparece se ja for a escolhida
  const billOptions = (selectedId: string) =>
    bills.filter((bill) => bill.currency_code === currency && (bill.active || bill.id === selectedId));

  // Saida so mostra categoria de saida, entrada so de entrada; transferencia mostra as duas
  // (nao e nem uma coisa nem outra, e so dinheiro mudando de conta). A ja escolhida continua
  // aparecendo mesmo se nao bater mais (lancamento antigo, de antes desta categoria ter um tipo).
  const categoryKind = state.kind === "withdrawal" ? "expense" : state.kind === "deposit" ? "revenue" : null;
  const categoryOptions = (selectedId: string) =>
    categoryKind ? categories.filter((category) => category.kind === categoryKind || category.id === selectedId) : categories;

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
            {t("common.cancelar")}
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
        // Orcamento so vale em saida, e a categoria escolhida pode nao ser do novo sentido:
        // trocar o tipo solta os dois
        budgetId: "",
        billId: "",
        categoryId: "",
        splits:
          kind === "transfer"
            ? null
            : (state.splits?.map((row) => ({ ...row, budgetId: "", billId: "", categoryId: "" })) ?? null),
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
          budgetId: current.budgetId,
          billId: current.billId,
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
        budgetId: first?.budgetId ?? current.budgetId,
        billId: first?.billId ?? current.billId,
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

  function validateRepeat(): RepeatErrors {
    const found: RepeatErrors = {};
    if (name.trim() === "") found.name = t("transactions.form.recurrenceNameRequired");
    if (endMode === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) found.endDate = t("validation.dateInvalid");
      else if (state.date && endDate < state.date) found.endDate = t("transactions.form.endBeforeStart");
    }
    if (endMode === "count" && !/^[1-9]\d{0,4}$/.test(endCount.trim())) {
      found.endCount = t("transactions.form.endCountInvalid");
    }
    return found;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found = validateForm(state, ctx);
    setErrors(found);
    const repeatFound: RepeatErrors = recurring ? validateRepeat() : {};
    setRepeatErrors(repeatFound);
    if (repeatFound.name) {
      document.getElementById("rec-name")?.focus();
      return;
    }
    if (hasErrors(found)) {
      const order: [keyof FormErrors, string][] = [
        ["date", "tx-date"],
        ["accountId", "tx-account"],
        ["description", "tx-description"],
        ["counterparty", "tx-counterparty"],
        ["amount", "tx-amount"],
        ["foreignAmount", "tx-foreign-amount"],
        ["originalAmount", "tx-original-amount"],
      ];
      const first = order.find(([field]) => found[field]);
      if (first) document.getElementById(first[1])?.focus();
      return;
    }
    if (repeatFound.endDate || repeatFound.endCount) {
      document.getElementById(repeatFound.endDate ? "rec-end-date" : "rec-end-count")?.focus();
      return;
    }

    try {
      const body = buildPayload(state, ctx);
      if (recurring) {
        const end = {
          end_date: endMode === "date" ? endDate : null,
          max_occurrences: endMode === "count" ? Number(endCount) : null,
        };
        if (recurrence) {
          await updateRecurrence.mutateAsync({ id: recurrence.id, body: { name: name.trim(), template: body, ...end } });
        } else {
          await createRecurrence.mutateAsync({ name: name.trim(), frequency, first_date: state.date, template: body, ...end });
        }
      } else if (transaction) await update.mutateAsync({ id: transaction.id, body });
      else await create.mutateAsync(body);
      onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  const counterpartyLabel =
    state.kind === "transfer"
      ? t("transactions.form.toAccount")
      : state.ownCounterparty
        ? t("transactions.form.debtLabel")
        : state.kind === "withdrawal"
          ? t("transactions.form.toWhom")
          : t("transactions.form.fromWhom");

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert variant="destructive">{formError}</Alert>}

      {recurring && (
        <div className="flex flex-col gap-4 rounded-md border p-3">
          <FormField id="rec-name" label={t("transactions.transactionFormDialog.nomeDaRecorrente")} error={repeatErrors.name}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setRepeatErrors((current) => ({ ...current, name: undefined }));
                }}
              />
            )}
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="rec-frequency" label={t("transactions.transactionFormDialog.frequencia")}>
              {(props) => (
                <Select
                  {...props}
                  value={frequency}
                  disabled={editing}
                  onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                >
                  {FREQUENCIES.map((option) => (
                    <option key={option} value={option}>
                      {frequencyLabel(option)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField id="rec-end" label={t("transactions.transactionFormDialog.termina")}>
              {(props) => (
                <Select {...props} value={endMode} onChange={(e) => setEndMode(e.target.value as EndMode)}>
                  <option value="never">{t("transactions.transactionFormDialog.nunca")}</option>
                  <option value="date">{t("transactions.transactionFormDialog.numaData")}</option>
                  <option value="count">{t("transactions.transactionFormDialog.depoisDeNVezes")}</option>
                </Select>
              )}
            </FormField>
          </div>

          {endMode === "date" && (
            <FormField id="rec-end-date" label={t("common.dataFinal")} error={repeatErrors.endDate}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setRepeatErrors((current) => ({ ...current, endDate: undefined }));
                  }}
                />
              )}
            </FormField>
          )}
          {endMode === "count" && (
            <FormField id="rec-end-count" label={t("transactions.transactionFormDialog.quantasVezes")} error={repeatErrors.endCount}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  autoComplete="off"
                  value={endCount}
                  onChange={(e) => {
                    setEndCount(e.target.value);
                    setRepeatErrors((current) => ({ ...current, endCount: undefined }));
                  }}
                />
              )}
            </FormField>
          )}
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t("common.tipo")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {KIND_OPTIONS.map((option) => (
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
              {t(`transactions.form.kind.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          id="tx-date"
          label={recurring ? t("transactions.transactionFormDialog.primeiraData") : t("common.data")}
          error={errors.date}
          hint={
            recurring && !editing && state.date && state.date <= appToday()
              ? t("transactions.transactionFormDialog.osLancamentosDesdeEsta")
              : recurring && editing
                ? t("transactions.transactionFormDialog.aPrimeiraDataE")
                : undefined
          }
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              value={state.date}
              disabled={recurring && editing}
              onChange={(e) => patch({ date: e.target.value }, "date")}
            />
          )}
        </FormField>

        <FormField id="tx-account" label={state.kind === "deposit" ? t("transactions.transactionFormDialog.contaQueRecebe") : t("common.conta")} error={errors.accountId}>
          {(props) => (
            <Select
              {...props}
              value={state.accountId}
              onChange={(e) => {
                const next = accountOf(ctx, e.target.value);
                // Outra moeda: o orcamento escolhido deixa de valer
                const sameCurrency = next?.currency_code === currency;
                patch(
                  {
                    accountId: e.target.value,
                    foreignAmount: "",
                    // A moeda original nao pode ser a da conta: se passou a ser, nao ha mais o que informar
                    ...(state.originalCurrency !== "" && next?.currency_code === state.originalCurrency
                      ? { originalCurrency: "", originalAmount: "" }
                      : {}),
                    ...(sameCurrency ? {} : { budgetId: "", billId: "", splits: clearBudgets(state.splits) }),
                  },
                  "accountId",
                  "foreignAmount",
                  "originalAmount",
                );
              }}
            >
              <option value="">{t("common.escolha")}</option>
              {selectable.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.active ? "" : ` ${t("transactions.transactionFormDialog.arquivada")}`}
                  {option.currency_code !== "BRL" ? ` - ${option.currency_code}` : ""}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <FormField
        id="tx-description"
        label={state.splits ? t("transactions.transactionFormDialog.tituloOpcional") : t("common.descricao")}
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
              <option value="">{t("common.escolha")}</option>
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
                <option value="">{t("common.escolha")}</option>
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
            {state.kind === "withdrawal" ? t("transactions.transactionFormDialog.pagarParaUmNome") : t("transactions.transactionFormDialog.receberDeUmNome")}
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
              onClick={() =>
                patch(
                  {
                    ownCounterparty: true,
                    counterpartyName: "",
                    budgetId: "",
                    billId: "",
                    splits: clearBudgets(state.splits),
                  },
                  "counterparty",
                )
              }
            >
              {state.kind === "withdrawal" ? t("transactions.transactionFormDialog.pagarUmaDivida") : t("transactions.transactionFormDialog.receberDeUmaDivida")}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          id="tx-amount"
          label={state.splits ? t("transactions.form.totalAmount", { currency }) : t("transactions.form.amount", { currency })}
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
          <FormField id="tx-foreign-amount" label={t("transactions.form.arrivingAmount", { currency: other.currency_code })} error={errors.foreignAmount}>
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

      {installmentsAllowed(state, ctx) && !editing && !recurring && (
        <FormField
          id="tx-installments"
          label={t("transactions.transactionFormDialog.parcelarEmQuantasVezes")}
          error={errors.installments}
        >
          {(props) => (
            <Select {...props} value={state.installments} onChange={(e) => patch({ installments: e.target.value }, "installments")}>
              <option value="1">{t("transactions.transactionFormDialog.naoParcelar")}</option>
              {Array.from({ length: 23 }, (_, index) => index + 2).map((count) => (
                <option key={count} value={String(count)}>
                  {t("transactions.transactionFormDialog.vezesCount", { count })}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}

      {originalAllowed(state) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            id="tx-original-currency"
            label={t("transactions.transactionFormDialog.moedaOriginalOpcional")}
            hint={t("transactions.transactionFormDialog.seACompraFoi")}
          >
            {(props) => (
              <Select
                {...props}
                value={originalChosen ? state.originalCurrency : ""}
                onChange={(e) => patch({ originalCurrency: e.target.value, originalAmount: "" }, "originalAmount")}
              >
                <option value="">{t("transactions.transactionFormDialog.nenhuma")}</option>
                {originalChosen && !originalCurrencies.some((item) => item.code === state.originalCurrency) && (
                  <option value={state.originalCurrency}>{state.originalCurrency}</option>
                )}
                {originalCurrencies.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} - {item.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          {originalChosen && (
            <FormField id="tx-original-amount" label={t("transactions.form.originalAmount", { currency: state.originalCurrency })} error={errors.originalAmount}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  value={state.originalAmount}
                  onChange={(e) => patch({ originalAmount: e.target.value }, "originalAmount")}
                />
              )}
            </FormField>
          )}
        </div>
      )}

      {/* Linhas da divisao, ou categoria e tags de um lancamento so */}
      {state.splits ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("transactions.transactionFormDialog.divisao")}</h3>
            <Button type="button" variant="ghost" size="sm" onClick={stopSplit}>
              {t("transactions.transactionFormDialog.desfazerDivisao")}
            </Button>
          </div>

          {state.splits.map((row, index) => {
            const rowErrors = errors.splits?.[row.key];
            return (
              <div key={row.key} className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">{t("transactions.form.row", { n: index + 1 })}</p>
                  {state.splits && state.splits.length > 1 && (
                    <button
                      type="button"
                      aria-label={t("transactions.form.removeRow", { n: index + 1 })}
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
                  <FormField id={`${row.key}-description`} label={t("transactions.form.rowDescription", { n: index + 1 })} error={rowErrors?.description}>
                    {(props) => (
                      <Input
                        {...props}
                        autoComplete="off"
                        value={row.description}
                        onChange={(e) => changeSplit(row.key, { description: e.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField id={`${row.key}-amount`} label={t("transactions.form.rowAmount", { n: index + 1 })} error={rowErrors?.amount}>
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
                <FormField id={`${row.key}-category`} label={t("transactions.form.rowCategory", { n: index + 1 })}>
                  {(props) => (
                    <Select
                      {...props}
                      value={row.categoryId}
                      onChange={(e) => changeSplit(row.key, { categoryId: e.target.value })}
                    >
                      <option value="">{t("common.semCategoria")}</option>
                      {categoryOptions(row.categoryId).map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                {budgetAllowed(state) && budgetOptions(row.budgetId).length > 0 && (
                  <FormField id={`${row.key}-budget`} label={t("transactions.form.rowBudget", { n: index + 1 })}>
                    {(props) => (
                      <Select
                        {...props}
                        value={row.budgetId}
                        onChange={(e) => changeSplit(row.key, { budgetId: e.target.value })}
                      >
                        <option value="">{t("transactions.transactionFormDialog.semOrcamento")}</option>
                        {budgetOptions(row.budgetId).map((budget) => (
                          <option key={budget.id} value={budget.id}>
                            {budget.name}
                            {budget.active ? "" : ` ${t("transactions.transactionFormDialog.arquivado")}`}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                )}
                {budgetAllowed(state) && billOptions(row.billId).length > 0 && (
                  <FormField id={`${row.key}-bill`} label={t("transactions.form.rowBill", { n: index + 1 })}>
                    {(props) => (
                      <Select
                        {...props}
                        value={row.billId}
                        onChange={(e) => changeSplit(row.key, { billId: e.target.value })}
                      >
                        <option value="">{t("transactions.transactionFormDialog.ligarAutomaticamente")}</option>
                        <option value="none">{t("transactions.transactionFormDialog.naoLigarANenhuma")}</option>
                        {billOptions(row.billId).map((bill) => (
                          <option key={bill.id} value={bill.id}>
                            {bill.name}
                            {bill.active ? "" : ` ${t("transactions.transactionFormDialog.arquivada")}`}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                )}
                <TagPicker
                  tags={tags}
                  selected={row.tagIds}
                  label={t("transactions.form.rowTags", { n: index + 1 })}
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
            {t("transactions.transactionFormDialog.adicionarLinha")}
          </Button>

          {errors.splitTotal ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.splitTotal}
            </p>
          ) : (
            left !== null && (
              <p role="status" className="text-sm text-muted-foreground">
                {/^-?0+(\.0+)?$/.test(left)
                  ? t("transactions.transactionFormDialog.tudoDistribuido")
                  : splitRemainderText(left, currency)}
              </p>
            )
          )}
        </div>
      ) : (
        <>
          <FormField id="tx-category" label={t("common.categoria")}>
            {(props) => (
              <Select {...props} value={state.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
                <option value="">{t("common.semCategoria")}</option>
                {categoryOptions(state.categoryId).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {budgetAllowed(state) && budgetOptions(state.budgetId).length > 0 && (
            <FormField id="tx-budget" label={t("common.orcamento")}>
              {(props) => (
                <Select {...props} value={state.budgetId} onChange={(e) => patch({ budgetId: e.target.value })}>
                  <option value="">{t("transactions.transactionFormDialog.semOrcamento")}</option>
                  {budgetOptions(state.budgetId).map((budget) => (
                    <option key={budget.id} value={budget.id}>
                      {budget.name}
                      {budget.active ? "" : ` ${t("transactions.transactionFormDialog.arquivado")}`}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          {budgetAllowed(state) && billOptions(state.billId).length > 0 && (
            <FormField id="tx-bill" label={t("transactions.transactionFormDialog.contaAPagar")}>
              {(props) => (
                <Select {...props} value={state.billId} onChange={(e) => patch({ billId: e.target.value })}>
                  <option value="">{t("transactions.transactionFormDialog.ligarAutomaticamente")}</option>
                  <option value="none">{t("transactions.transactionFormDialog.naoLigarANenhuma")}</option>
                  {billOptions(state.billId).map((bill) => (
                    <option key={bill.id} value={bill.id}>
                      {bill.name}
                      {bill.active ? "" : ` ${t("transactions.transactionFormDialog.arquivada")}`}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          <TagPicker tags={tags} selected={state.tagIds} label={t("transactions.transactionFormDialog.tags")} onChange={(next) => patch({ tagIds: next })} />
          {splittable && (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={startSplit}>
              {t("transactions.transactionFormDialog.dividirLancamento")}
            </Button>
          )}
        </>
      )}

      <FormField id="tx-notes" label={t("transactions.transactionFormDialog.notas")}>
        {(props) => <Textarea {...props} value={state.notes} onChange={(e) => patch({ notes: e.target.value })} />}
      </FormField>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          {t("common.cancelar")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("transactions.transactionFormDialog.salvando") : editing ? t("transactions.transactionFormDialog.salvar") : recurring ? t("transactions.transactionFormDialog.criarRecorrente") : t("transactions.transactionFormDialog.criarLancamento")}
        </Button>
      </DialogFooter>
    </form>
  );
}

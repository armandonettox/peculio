import { Bookmark, CalendarDays, CircleCheck, FileText, Info, Landmark, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAccounts, useCurrencies } from "@/api/accounts";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  uploadAttachmentFile,
  useRefreshAttachments,
} from "@/api/attachments";
import { useBudgets, type Budget } from "@/api/budgets";
import { useDeleteFavorite, useFavorites, useSaveFavorite, type Suggestion } from "@/api/favorites";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useCategories, useTags, type Category, type Tag } from "@/api/labels";
import {
  useCreateRecurrence,
  useReminderRecurrences,
  type Recurrence,
  type RecurrenceFrequency,
} from "@/api/recurrences";
import {
  useCounterparties,
  useCreateTransaction,
  useUpdateTransaction,
  type Transaction,
} from "@/api/transactions";
import { ChipSelect, type ChipOption } from "@/components/chip-select";
import { FormField } from "@/components/form-field";
import { MoneyInput } from "@/components/money-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CategoryIcon } from "@/features/labels/category-icon";
import { DescriptionField } from "./description-field";
import { FREQUENCIES, frequencyLabel } from "@/features/recurrences/presentation";
import { appToday, shiftDay } from "@/lib/dates";
import { placesOf } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  accountOf,
  billAllowed,
  budgetAllowed,
  buildPayload,
  canSplit,
  emptyForm,
  emptySplit,
  foreignAccount,
  formFromTransaction,
  hasErrors,
  isLiability,
  originalAllowed,
  remainder,
  splitRemainderText,
  validateForm,
  type FormContext,
  type FormErrors,
  type FormState,
  type SplitDraft,
} from "./form-model";

// Campos sem borda de caixa, so uma linha embaixo, como no formulario de referencia
const UNDERLINED = "rounded-none border-0 border-b bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:border-primary";

// Despesa e receita sao o mesmo formulario por dentro (so mudam cor, textos e o lado do dinheiro), mas cada uma tem
// o seu componente de entrada e o seu titulo: ExpenseFormDialog e IncomeFormDialog.
type MoneyKind = "withdrawal" | "deposit";

type Props = {
  // Sem `transaction` cria; com `transaction` edita
  transaction?: Transaction;
  onClose: () => void;
};

type Repeat = {
  // Despesa fixa: todo mes, sem data final
  fixed: boolean;
  // Repetir N vezes na frequencia escolhida
  repeat: boolean;
  count: string;
  frequency: RecurrenceFrequency;
};

const NO_REPEAT: Repeat = { fixed: false, repeat: false, count: "2", frequency: "monthly" };

/**
 * Esta tela serve para despesa que nao e de cartao de credito e que nao paga divida: as outras (cartao, receita,
 * transferencia) tem o proprio formulario.
 */
export function usesIncomeForm(transaction: Transaction): boolean {
  const [first] = transaction.splits;
  return first?.type === "deposit" && first.source_account_type === "revenue";
}

export function usesExpenseForm(transaction: Transaction, accounts: { id: string; role: string | null }[]): boolean {
  const [first] = transaction.splits;
  if (!first || first.type !== "withdrawal") return false;
  if (first.destination_account_type !== "expense") return false;
  const own = accounts.find((account) => account.id === first.source_account_id);
  return own?.role !== "credit_card";
}

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

// Uma linha do formulario: icone na frente e o campo ao lado
function Row({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ExpenseFormDialog(props: Props) {
  return <MoneyFormDialog kind="withdrawal" {...props} />;
}

export function IncomeFormDialog(props: Props) {
  return <MoneyFormDialog kind="deposit" {...props} />;
}

function MoneyFormDialog({ kind, transaction, onClose }: Props & { kind: MoneyKind }) {
  const { t } = useTranslation();
  const income = kind === "deposit";
  const editing = transaction !== undefined;
  const accountsQuery = useAccounts({ includeArchived: true });
  const currencies = useCurrencies();
  const categories = useCategories({ search: "" });
  const tags = useTags({ search: "" });
  const budgets = useBudgets({ activeOnly: false });
  const bills = useReminderRecurrences({ activeOnly: false });
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const createRecurrence = useCreateRecurrence();
  const busy = create.isPending || update.isPending || createRecurrence.isPending;
  // "Mais detalhes" abre a segunda coluna e alarga a janela, por isso o estado mora aqui
  const [showDetails, setShowDetails] = useState(false);

  const ready = accountsQuery.data !== undefined && currencies.data !== undefined;
  const ctx: FormContext = useMemo(
    () => ({
      accounts: accountsQuery.data ?? [],
      places: Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places])),
    }),
    [accountsQuery.data, currencies.data],
  );
  const loadError = accountsQuery.isError || currencies.isError ? getErrorMessage(accountsQuery.error ?? currencies.error) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent fullOnMobile className={showDetails ? "max-w-3xl" : "max-w-md"}>
        <DialogHeader>
          <DialogTitle>
            {income
              ? editing
                ? t("transactions.incomeForm.editTitle")
                : t("transactions.incomeForm.title")
              : editing
                ? t("transactions.expenseForm.editTitle")
                : t("transactions.expenseForm.title")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("transactions.transactionFormDialog.registreUmaSaidaUma")}</DialogDescription>
        </DialogHeader>
        {loadError && <Alert variant="destructive">{loadError}</Alert>}
        {!ready && !loadError && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("common.carregando")}
          </p>
        )}
        {ready && (
          <FormBody
            kind={kind}
            ctx={ctx}
            currencies={currencies.data ?? []}
            transaction={transaction}
            categories={categories.data?.items ?? []}
            tags={tags.data?.items ?? []}
            budgets={budgets.data ?? []}
            bills={bills.data ?? []}
            create={create}
            update={update}
            createRecurrence={createRecurrence}
            showDetails={showDetails}
            setShowDetails={setShowDetails}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type BodyProps = {
  kind: MoneyKind;
  ctx: FormContext;
  currencies: { code: string; name: string; symbol: string }[];
  transaction?: Transaction;
  categories: Category[];
  tags: Tag[];
  budgets: Budget[];
  bills: Recurrence[];
  create: ReturnType<typeof useCreateTransaction>;
  update: ReturnType<typeof useUpdateTransaction>;
  createRecurrence: ReturnType<typeof useCreateRecurrence>;
  showDetails: boolean;
  setShowDetails: (open: boolean | ((current: boolean) => boolean)) => void;
  onClose: () => void;
};

// Sem "para quem" preenchido, vale a descricao: o campo mora em "Mais detalhes" e nao pode travar o salvar
function withDefaultCounterparty(state: FormState): FormState {
  if (state.ownCounterparty || state.counterpartyName.trim() !== "") return state;
  const fallback = state.description.trim() || state.splits?.[0]?.description.trim() || "";
  return { ...state, counterpartyName: fallback };
}

function hasDetails(state: FormState): boolean {
  return (
    state.splits !== null ||
    state.tagIds.length > 0 ||
    state.notes !== "" ||
    state.budgetId !== "" ||
    state.billId !== "" ||
    state.ownCounterparty ||
    state.originalCurrency !== ""
  );
}

function FormBody({
  kind,
  ctx,
  currencies,
  transaction,
  categories,
  tags,
  budgets,
  bills,
  create,
  update,
  createRecurrence,
  showDetails,
  setShowDetails,
  onClose,
}: BodyProps) {
  const { t } = useTranslation();
  const income = kind === "deposit";
  const editing = transaction !== undefined;
  const refreshAttachments = useRefreshAttachments();

  const [initial] = useState(() => (transaction ? formFromTransaction(transaction, ctx) : null));
  const [state, setState] = useState<FormState>(() => (initial?.ok ? initial.state : emptyForm(ctx, { kind })));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [otherDate, setOtherDate] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>(NO_REPEAT);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  // Salvo, mas algum anexo nao subiu: o lancamento ja existe, entao so resta fechar
  const [finished, setFinished] = useState(false);
  // Coracao: null = nao mexeu (vale o que ja existe); true = favoritar ao salvar; false = tirar dos favoritos ao salvar
  const [favoriteWanted, setFavoriteWanted] = useState<boolean | null>(null);
  const favoritesQuery = useFavorites(kind);
  const saveFavorite = useSaveFavorite();
  const deleteFavorite = useDeleteFavorite();
  const fileInput = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);

  // Ao editar um lancamento que ja tem tags, orcamento, divisao etc., abre direto em "Mais detalhes"
  useEffect(() => {
    if (initial?.ok && hasDetails(initial.state)) setShowDetails(true);
    // So na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const account = accountOf(ctx, state.accountId);
  const currency = account?.currency_code ?? "BRL";
  const places = placesOf(currency, ctx.places);
  const other = foreignAccount(state, ctx);
  const originalCurrencies = currencies.filter((item) => item.code !== currency);
  const originalChosen = state.originalCurrency !== "" && state.originalCurrency !== currency;
  const splittable = canSplit(state, ctx);
  const left = remainder(state, ctx);
  const today = appToday();
  const yesterday = shiftDay(today, -1);
  const recurringMode = !editing && (repeat.fixed || repeat.repeat);
  const submitting = create.isPending || update.isPending || createRecurrence.isPending;

  const budgetOptions = (selectedId: string) =>
    budgets.filter((budget) => budget.currency_code === currency && (budget.active || budget.id === selectedId));
  const billOptions = (selectedId: string) =>
    bills.filter((bill) => bill.type === kind && bill.currency_code === currency && (bill.active || bill.id === selectedId));
  const categoryChips = (selectedId: string): ChipOption[] => [
    { value: "", label: t("common.semCategoria"), leading: <CategoryIcon name="tag" /> },
    ...categoryOptions(selectedId).map((category) => ({
      value: category.id,
      label: category.name,
      leading: <CategoryIcon name={category.icon} color={category.color} />,
    })),
  ];
  const categoryOptions = (selectedId: string) =>
    categories.filter((category) => category.kind === (income ? "revenue" : "expense") || category.id === selectedId);

  const selectable = ctx.accounts.filter((a) => a.active || a.id === state.accountId || a.id === state.counterpartyAccountId);
  // So conta com algum digito diferente de zero (o campo formata sozinho: "0,00" e vazio, "12,50" e valor)
  const accountChips: ChipOption[] = selectable.map((option) => ({
    value: option.id,
    label: `${option.name}${option.active ? "" : ` ${t("transactions.transactionFormDialog.arquivada")}`}`,
    hint: option.currency_code !== "BRL" ? option.currency_code : undefined,
    leading: <CategoryIcon icon={Landmark} color={option.color} />,
  }));
  const favoriteFor = (text: string) =>
    (favoritesQuery.data ?? []).find((item) => item.description.toLowerCase() === text.trim().toLowerCase());
  const isFavorite = favoriteWanted ?? Boolean(favoriteFor(state.description));
  const amountFilled = /[1-9]/.test(state.amount);
  const symbol = currencies.find((item) => item.code === currency)?.symbol ?? currency;
  const accountCurrencies = Array.from(new Set(selectable.map((a) => a.currency_code))).sort();

  const suggestions = useCounterparties(income ? "revenue" : "expense", state.counterpartyName.trim(), { enabled: !state.ownCounterparty });
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

  // Troca a conta e solta o que depende da moeda ou da conta anterior (orcamento, conta a pagar, valor que chega)
  function chooseAccount(accountId: string) {
    const next = accountOf(ctx, accountId);
    const sameCurrency = next?.currency_code === currency;
    patch(
      {
        accountId,
        foreignAmount: "",
        ...(state.originalCurrency !== "" && next?.currency_code === state.originalCurrency
          ? { originalCurrency: "", originalAmount: "" }
          : {}),
        ...(sameCurrency ? {} : { budgetId: "", billId: "", splits: clearBudgets(state.splits) }),
      },
      "accountId",
      "foreignAmount",
      "originalAmount",
    );
  }

  // A moeda do lancamento e a da conta: escolher outra moeda leva para a primeira conta ativa dela (de ativo antes)
  // Escolher uma sugestao preenche descricao, categoria e conta (nunca o valor), so com o que ainda vale
  function pickSuggestion(suggestion: Suggestion) {
    patch({ description: suggestion.description }, "description");
    if (suggestion.category_id && categoryOptions("").some((category) => category.id === suggestion.category_id)) {
      patch({ categoryId: suggestion.category_id });
    }
    if (suggestion.account_id && selectable.some((a) => a.id === suggestion.account_id && a.active)) {
      chooseAccount(suggestion.account_id);
    }
    setFavoriteWanted(null);
  }

  function describeSuggestion(suggestion: Suggestion): string {
    const categoryName = categories.find((category) => category.id === suggestion.category_id)?.name;
    const accountName = ctx.accounts.find((a) => a.id === suggestion.account_id)?.name;
    return [categoryName, accountName].filter(Boolean).join(" · ");
  }

  // Grava ou tira o favorito conforme o coracao, depois de o lancamento ja estar salvo. Devolve um aviso se falhar.
  async function syncFavorite(effective: FormState): Promise<string | null> {
    const text = effective.description.trim() || effective.splits?.[0]?.description.trim() || "";
    if (!text || favoriteWanted === null) return null;
    const existing = favoriteFor(text);
    try {
      if (favoriteWanted) {
        await saveFavorite.mutateAsync({
          type: kind,
          description: text,
          category_id: effective.categoryId || null,
          account_id: effective.accountId || null,
        });
      } else if (existing) {
        await deleteFavorite.mutateAsync(existing.id);
      }
    } catch {
      return t("transactions.expenseForm.favoriteFailed");
    }
    return null;
  }

  function chooseCurrency(code: string) {
    if (code === currency) return;
    const inCurrency = selectable.filter((a) => a.currency_code === code && a.active);
    const next = inCurrency.find((a) => a.type === "asset") ?? inCurrency[0];
    if (next) chooseAccount(next.id);
  }

  const clearBudgets = (rows: SplitDraft[] | null) => rows?.map((row) => ({ ...row, budgetId: "", billId: "" })) ?? null;

  function changeSplit(key: string, changes: Partial<SplitDraft>) {
    setState((current) => ({
      ...current,
      splits: current.splits?.map((row) => (row.key === key ? { ...row, ...changes } : row)) ?? null,
    }));
    setErrors((current) => ({ ...current, splitTotal: undefined, splits: undefined }));
  }

  function startSplit() {
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

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFileError(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_ATTACHMENTS_PER_TRANSACTION) {
        setFileError(t("transactions.expenseForm.attachLimit", { max: MAX_ATTACHMENTS_PER_TRANSACTION }));
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setFileError(t("transactions.expenseForm.fileTooBig", { name: file.name }));
        continue;
      }
      next.push(file);
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  }

  function chooseRepeat(changes: Partial<Repeat>) {
    setRepeat((current) => {
      const next = { ...current, ...changes };
      // Fixa e repetir N vezes se excluem: ligar uma desliga a outra
      if (changes.fixed) next.repeat = false;
      if (changes.repeat) next.fixed = false;
      return next;
    });
    setRepeatError(null);
  }

  function handleServerError(error: unknown) {
    const message = getErrorMessage(error);
    if (error instanceof ApiError && (error.code === "invalid_amount" || error.code === "currency_mismatch")) {
      setErrors({ amount: message });
      amountInput.current?.focus();
      return;
    }
    setFormError(message);
  }

  function resetForNext() {
    setState(emptyForm(ctx, { kind, accountId: state.accountId }));
    setErrors({});
    setFiles([]);
    setFileError(null);
    setRepeat(NO_REPEAT);
    setOtherDate(false);
    setFavoriteWanted(null);
    amountInput.current?.focus();
  }

  async function save(andNew: boolean) {
    if (submitting) return;
    setFormError(null);

    const effective = withDefaultCounterparty(state);
    const found = validateForm(effective, ctx);
    setErrors(found);
    let repeatFound: string | null = null;
    if (recurringMode && repeat.repeat && !/^([2-9]|[1-9]\d{1,2})$/.test(repeat.count.trim())) {
      repeatFound = t("transactions.expenseForm.repeatCountInvalid");
    }
    setRepeatError(repeatFound);
    if (hasErrors(found)) {
      const order: [keyof FormErrors, string][] = [
        ["amount", "tx-amount"],
        ["date", "tx-date"],
        ["description", "tx-description"],
        ["accountId", "tx-account"],
        ["counterparty", "tx-counterparty"],
        ["foreignAmount", "tx-foreign-amount"],
        ["originalAmount", "tx-original-amount"],
      ];
      const first = order.find(([field]) => found[field]);
      if (first) {
        if (first[0] === "counterparty") setShowDetails(true);
        document.getElementById(first[1])?.focus();
      }
      return;
    }
    if (repeatFound) {
      document.getElementById("exp-repeat-count")?.focus();
      return;
    }

    try {
      const body = buildPayload(effective, ctx);
      const warnings: string[] = [];
      if (recurringMode) {
        await createRecurrence.mutateAsync({
          name: effective.description.trim() || effective.splits?.[0]?.description.trim() || effective.counterpartyName.trim(),
          auto_create: true,
          frequency: repeat.fixed ? "monthly" : repeat.frequency,
          first_date: state.date,
          template: body,
          end_date: null,
          max_occurrences: repeat.repeat ? Number(repeat.count) : null,
        });
      } else if (transaction) {
        await update.mutateAsync({ id: transaction.id, body });
      } else {
        const created = await create.mutateAsync(body);
        const failed: string[] = [];
        for (const file of files) {
          try {
            await uploadAttachmentFile(created.id, file);
          } catch {
            failed.push(file.name);
          }
        }
        if (files.length > 0) await refreshAttachments();
        if (failed.length > 0) warnings.push(t("transactions.expenseForm.attachFailed", { names: failed.join(", ") }));
      }
      const favoriteWarning = await syncFavorite(effective);
      if (favoriteWarning) warnings.push(favoriteWarning);
      if (warnings.length > 0) {
        // O lancamento ja esta salvo; so resta avisar o que nao deu certo e fechar
        setFormError(warnings.join(" "));
        setFinished(true);
        return;
      }
      if (andNew && !editing) resetForNext();
      else onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  const dateIs = (value: string) => state.date === value && !otherDate;
  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active ? (income ? "bg-positive text-background" : "bg-destructive text-destructive-foreground") : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
    );

  const left_column = (
    <div className="flex min-w-0 flex-col gap-4">
      <FormField
        id="tx-amount"
        hideLabel
        label={state.splits ? t("transactions.form.totalAmount", { currency }) : t("transactions.form.amount", { currency })}
        error={errors.amount}
      >
        {(props) => (
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className={cn("text-xl font-semibold", income ? "text-positive" : "text-destructive")}>
              {symbol}
            </span>
            <MoneyInput
              {...props}
              ref={amountInput}
              placeholder="0,00"
              places={places}
              value={state.amount}
              onChange={(text) => patch({ amount: text }, "amount", "splitTotal")}
              onBlur={() => {
                if (!amountFilled) setErrors((current) => ({ ...current, amount: t("money.required") }));
              }}
              className={cn(
                UNDERLINED,
                "h-10 text-xl font-semibold",
                income ? "text-positive placeholder:text-positive" : "text-destructive placeholder:text-destructive",
              )}
            />
            <Select
              aria-label={t("transactions.expenseForm.currency")}
              value={currency}
              onChange={(e) => chooseCurrency(e.target.value)}
              className="h-8 w-auto shrink-0 rounded-none border-0 bg-transparent px-1 text-xs font-medium text-muted-foreground shadow-none"
            >
              {accountCurrencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </div>
        )}
      </FormField>

      <Row icon={CircleCheck}>
        <div className="flex items-center justify-between gap-3">
          <span id="exp-paid-label" className="text-sm text-muted-foreground">
            {state.isPaid
              ? income
                ? t("transactions.incomeForm.received")
                : t("transactions.expenseForm.paid")
              : income
                ? t("transactions.incomeForm.notReceived")
                : t("transactions.expenseForm.unpaid")}
          </span>
          <Switch checked={state.isPaid} onCheckedChange={(next) => patch({ isPaid: next })} aria-labelledby="exp-paid-label" />
        </div>
      </Row>

      <Row icon={CalendarDays}>
        <div role="group" aria-label={t("common.data")} className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={dateIs(today)}
            className={chip(dateIs(today))}
            onClick={() => {
              setOtherDate(false);
              patch({ date: today }, "date");
            }}
          >
            {t("transactions.expenseForm.today")}
          </button>
          <button
            type="button"
            aria-pressed={dateIs(yesterday)}
            className={chip(dateIs(yesterday))}
            onClick={() => {
              setOtherDate(false);
              patch({ date: yesterday }, "date");
            }}
          >
            {t("transactions.expenseForm.yesterday")}
          </button>
          <button
            type="button"
            aria-pressed={otherDate || (state.date !== today && state.date !== yesterday)}
            className={chip(otherDate || (state.date !== today && state.date !== yesterday))}
            onClick={() => setOtherDate(true)}
          >
            {t("transactions.expenseForm.otherDate")}
          </button>
        </div>
        {(otherDate || (state.date !== today && state.date !== yesterday)) && (
          <div className="mt-2">
            <Input
              id="tx-date"
              type="date"
              aria-label={t("common.data")}
              aria-invalid={Boolean(errors.date)}
              value={state.date}
              onChange={(e) => patch({ date: e.target.value }, "date")}
              className={UNDERLINED}
            />
            {errors.date && <p className="mt-1 text-xs text-destructive">{errors.date}</p>}
          </div>
        )}
      </Row>

      <Row icon={FileText}>
        <FormField
          id="tx-description"
          hideLabel
          label={state.splits ? t("transactions.transactionFormDialog.tituloOpcional") : t("common.descricao")}
          error={errors.description}
        >
          {(props) => (
            <DescriptionField
              {...props}
              type={kind}
              placeholder={state.splits ? t("transactions.transactionFormDialog.tituloOpcional") : t("common.descricao")}
              value={state.description}
              onChange={(text) => patch({ description: text }, "description")}
              favorite={isFavorite}
              onToggleFavorite={() => setFavoriteWanted(!isFavorite)}
              onPick={pickSuggestion}
              describe={describeSuggestion}
              heartClassName={income ? "text-positive" : "text-destructive"}
              underlined={UNDERLINED}
            />
          )}
        </FormField>
      </Row>

      {!state.splits && (
        <Row icon={Bookmark}>
          <FormField id="tx-category" hideLabel label={t("common.categoria")}>
            {(props) => (
              <ChipSelect
                {...props}
                value={state.categoryId}
                options={categoryChips(state.categoryId)}
                placeholder={t("common.semCategoria")}
                onChange={(next) => patch({ categoryId: next })}
              />
            )}
          </FormField>
        </Row>
      )}

      <Row icon={Landmark}>
        <FormField id="tx-account" hideLabel label={t("common.conta")} error={errors.accountId}>
          {(props) => (
            <ChipSelect
              {...props}
              value={state.accountId}
              options={accountChips}
              placeholder={t("common.escolha")}
              onChange={chooseAccount}
            />
          )}
        </FormField>
      </Row>

      {!editing && !recurringMode && (
        <Row icon={Paperclip}>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="self-start text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("transactions.expenseForm.attach")}
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-label={t("transactions.expenseForm.attach")}
              onChange={(e) => addFiles(e.target.files)}
            />
            {files.length > 0 && (
              <ul className="flex flex-col gap-1">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 break-words">{file.name}</span>
                    <button
                      type="button"
                      aria-label={t("transactions.expenseForm.removeFile", { name: file.name })}
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {fileError && (
              <p role="alert" className="text-xs text-destructive">
                {fileError}
              </p>
            )}
          </div>
        </Row>
      )}

      <Row icon={Info}>
        <div className="flex items-center justify-between gap-3">
          <span id="exp-ignore-label" className="flex items-center gap-1 text-sm text-muted-foreground">
            {t("transactions.expenseForm.ignore")}
            <button
              type="button"
              aria-label={t("transactions.expenseForm.ignoreInfoButton")}
              aria-expanded={showInfo}
              aria-controls="exp-ignore-info"
              onClick={() => setShowInfo((current) => !current)}
              className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info className="size-3.5" aria-hidden="true" />
            </button>
          </span>
          <Switch checked={state.ignored} onCheckedChange={(next) => patch({ ignored: next })} aria-labelledby="exp-ignore-label" />
        </div>
        {showInfo && (
          <p id="exp-ignore-info" className="mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
            {t("transactions.expenseForm.ignoreInfo")}
          </p>
        )}
      </Row>

      <button
        type="button"
        aria-expanded={showDetails}
        onClick={() => setShowDetails((current) => !current)}
        className="self-end text-sm font-medium text-primary-text transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {showDetails ? t("transactions.expenseForm.lessDetails") : t("transactions.expenseForm.moreDetails")} {showDetails ? "‹" : "›"}
      </button>
    </div>
  );

  const details = (
    <div className="flex min-w-0 flex-col gap-4">
      {!state.splits && (
        <TagPicker tags={tags} selected={state.tagIds} label={t("transactions.transactionFormDialog.tags")} onChange={(next) => patch({ tagIds: next })} />
      )}

      <FormField id="tx-notes" label={t("transactions.transactionFormDialog.notas")}>
        {(props) => <Textarea {...props} value={state.notes} onChange={(e) => patch({ notes: e.target.value })} />}
      </FormField>

      {!editing && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span id="exp-fixed-label" className="text-sm">
              {income ? t("transactions.incomeForm.fixed") : t("transactions.expenseForm.fixed")}
            </span>
            <Switch checked={repeat.fixed} onCheckedChange={(next) => chooseRepeat({ fixed: next })} aria-labelledby="exp-fixed-label" />
          </div>
          {repeat.fixed && <p className="-mt-2 text-xs text-muted-foreground">{t("transactions.expenseForm.fixedHint")}</p>}
          <div className="flex items-center justify-between gap-3">
            <span id="exp-repeat-label" className="text-sm">
              {t("transactions.expenseForm.repeat")}
            </span>
            <Switch checked={repeat.repeat} onCheckedChange={(next) => chooseRepeat({ repeat: next })} aria-labelledby="exp-repeat-label" />
          </div>
          {repeat.repeat && (
            <div className="grid grid-cols-[6rem_1fr] items-start gap-3">
              <FormField id="exp-repeat-count" label={t("transactions.expenseForm.times")} error={repeatError ?? undefined}>
                {(props) => (
                  <Input
                    {...props}
                    inputMode="numeric"
                    autoComplete="off"
                    value={repeat.count}
                    onChange={(e) => chooseRepeat({ count: e.target.value })}
                  />
                )}
              </FormField>
              <FormField id="exp-repeat-frequency" label={t("transactions.transactionFormDialog.frequencia")}>
                {(props) => (
                  <Select {...props} value={repeat.frequency} onChange={(e) => chooseRepeat({ frequency: e.target.value as RecurrenceFrequency })}>
                    {FREQUENCIES.map((option) => (
                      <option key={option} value={option}>
                        {frequencyLabel(option)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
          )}
        </div>
      )}

      {state.ownCounterparty ? (
        <div className="flex flex-col gap-2">
          <FormField id="tx-counterparty" label={t("transactions.form.debtLabel")} error={errors.counterparty}>
            {(props) => (
              <Select
                {...props}
                value={state.counterpartyAccountId}
                onChange={(e) => patch({ counterpartyAccountId: e.target.value, foreignAmount: "" }, "counterparty", "foreignAmount")}
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
            onClick={() => patch({ ownCounterparty: false, counterpartyAccountId: "", foreignAmount: "" }, "counterparty", "foreignAmount")}
          >
            {income ? t("transactions.transactionFormDialog.receberDeUmNome") : t("transactions.transactionFormDialog.pagarParaUmNome")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <FormField id="tx-counterparty" label={income ? t("transactions.form.fromWhom") : t("transactions.form.toWhom")} error={errors.counterparty} hint={t("transactions.expenseForm.toWhomHint")}>
            {(props) => (
              <>
                <Input
                  {...props}
                  autoComplete="off"
                  list="exp-counterparty-options"
                  value={state.counterpartyName}
                  onChange={(e) => patch({ counterpartyName: e.target.value }, "counterparty")}
                />
                <datalist id="exp-counterparty-options">
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
                patch({ ownCounterparty: true, counterpartyName: "", budgetId: "", billId: "", splits: clearBudgets(state.splits) }, "counterparty")
              }
            >
              {income ? t("transactions.transactionFormDialog.receberDeUmaDivida") : t("transactions.transactionFormDialog.pagarUmaDivida")}
            </button>
          )}
        </div>
      )}

      {other && (
        <FormField id="tx-foreign-amount" label={t("transactions.form.arrivingAmount", { currency: other.currency_code })} error={errors.foreignAmount}>
          {(props) => (
            <MoneyInput
              {...props}
              placeholder="0,00"
              places={placesOf(other.currency_code, ctx.places)}
              value={state.foreignAmount}
              onChange={(text) => patch({ foreignAmount: text }, "foreignAmount")}
            />
          )}
        </FormField>
      )}

      {!state.splits && (
        <>
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
          {billAllowed(state) && billOptions(state.billId).length > 0 && (
            <FormField id="tx-bill" label={income ? t("transactions.transactionFormDialog.recebimentoEsperado") : t("transactions.transactionFormDialog.contaAPagar")}>
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
        </>
      )}

      {originalAllowed(state) && (
        <div className="flex flex-col gap-3">
          <FormField id="tx-original-currency" label={t("transactions.transactionFormDialog.moedaOriginalOpcional")} hint={t("transactions.transactionFormDialog.seACompraFoi")}>
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
                <MoneyInput
                  {...props}
                  placeholder="0,00"
                  places={placesOf(state.originalCurrency, ctx.places)}
                  value={state.originalAmount}
                  onChange={(text) => patch({ originalAmount: text }, "originalAmount")}
                />
              )}
            </FormField>
          )}
        </div>
      )}

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
                        setState((current) => ({ ...current, splits: current.splits?.filter((item) => item.key !== row.key) ?? null }))
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
                      <Input {...props} autoComplete="off" value={row.description} onChange={(e) => changeSplit(row.key, { description: e.target.value })} />
                    )}
                  </FormField>
                  <FormField id={`${row.key}-amount`} label={t("transactions.form.rowAmount", { n: index + 1 })} error={rowErrors?.amount}>
                    {(props) => (
                      <MoneyInput {...props} placeholder="0,00" places={places} value={row.amount} onChange={(text) => changeSplit(row.key, { amount: text })} />
                    )}
                  </FormField>
                </div>
                <FormField id={`${row.key}-category`} label={t("transactions.form.rowCategory", { n: index + 1 })}>
                  {(props) => (
                    <Select {...props} value={row.categoryId} onChange={(e) => changeSplit(row.key, { categoryId: e.target.value })}>
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
                      <Select {...props} value={row.budgetId} onChange={(e) => changeSplit(row.key, { budgetId: e.target.value })}>
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
                {billAllowed(state) && billOptions(row.billId).length > 0 && (
                  <FormField id={`${row.key}-bill`} label={t(income ? "transactions.form.rowBillIncome" : "transactions.form.rowBill", { n: index + 1 })}>
                    {(props) => (
                      <Select {...props} value={row.billId} onChange={(e) => changeSplit(row.key, { billId: e.target.value })}>
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
            onClick={() => setState((current) => ({ ...current, splits: [...(current.splits ?? []), emptySplit()] }))}
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
                {/^-?0+(\.0+)?$/.test(left) ? t("transactions.transactionFormDialog.tudoDistribuido") : splitRemainderText(left, currency)}
              </p>
            )
          )}
        </div>
      ) : (
        splittable && (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={startSplit}>
            {t("transactions.transactionFormDialog.dividirLancamento")}
          </Button>
        )
      )}
    </div>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
      className="flex flex-col gap-4"
    >
      {formError && <Alert variant="destructive">{formError}</Alert>}

      <div className={cn("grid gap-x-8 gap-y-4", showDetails && "md:grid-cols-2")}>
        {left_column}
        {showDetails && details}
      </div>

      <DialogFooter>
        {finished ? (
          <Button type="button" onClick={onClose}>
            {t("common.fechar")}
          </Button>
        ) : (
          <>
            {!editing && (
              <Button type="button" variant="ghost" disabled={submitting || !amountFilled} onClick={() => void save(true)}>
                {t("transactions.expenseForm.saveAndNew")}
              </Button>
            )}
            <Button type="submit" disabled={submitting || !amountFilled}>
              {submitting ? t("transactions.transactionFormDialog.salvando") : t("transactions.transactionFormDialog.salvar")}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}

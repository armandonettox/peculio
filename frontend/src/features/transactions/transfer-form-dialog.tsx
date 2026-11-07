import { ArrowDownToLine, ArrowUpFromLine, Landmark } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAccounts, useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useTags, type Tag } from "@/api/labels";
import { useCreateRecurrence } from "@/api/recurrences";
import { useCreateTransaction, useUpdateTransaction, type Transaction } from "@/api/transactions";
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
import { placesOf } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  accountOf,
  buildPayload,
  emptyForm,
  foreignAccount,
  formFromTransaction,
  hasErrors,
  validateForm,
  type FormContext,
  type FormErrors,
  type FormState,
} from "./form-model";
import { DateChips, Row, TagPicker, UNDERLINED } from "./form-parts";

type Props = {
  // Sem `transaction` cria uma transferencia; com `transaction` edita
  transaction?: Transaction;
  onClose: () => void;
};

/** Esta tela serve para a transferencia de um lancamento so; os outros tipos tem o proprio formulario. */
export function usesTransferForm(transaction: Transaction): boolean {
  const [first] = transaction.splits;
  return transaction.splits.length === 1 && first?.type === "transfer";
}

export function TransferFormDialog({ transaction, onClose }: Props) {
  const { t } = useTranslation();
  const editing = transaction !== undefined;
  const accountsQuery = useAccounts({ includeArchived: true });
  const currencies = useCurrencies();
  const tags = useTags({ search: "" });
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
          <DialogTitle>{editing ? t("transactions.transferForm.editTitle") : t("transactions.transferForm.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("transactions.transferForm.description")}</DialogDescription>
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
            tags={tags.data?.items ?? []}
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
  ctx: FormContext;
  currencies: { code: string; name: string; symbol: string }[];
  transaction?: Transaction;
  tags: Tag[];
  create: ReturnType<typeof useCreateTransaction>;
  update: ReturnType<typeof useUpdateTransaction>;
  createRecurrence: ReturnType<typeof useCreateRecurrence>;
  showDetails: boolean;
  setShowDetails: (open: boolean | ((current: boolean) => boolean)) => void;
  onClose: () => void;
};

function FormBody({
  ctx,
  currencies,
  transaction,
  tags,
  create,
  update,
  createRecurrence,
  showDetails,
  setShowDetails,
  onClose,
}: BodyProps) {
  const { t } = useTranslation();
  const editing = transaction !== undefined;
  const [initial] = useState(() => (transaction ? formFromTransaction(transaction, ctx) : null));
  const [state, setState] = useState<FormState>(() => (initial?.ok ? initial.state : emptyForm(ctx, { kind: "transfer" })));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Transferencia fixa: todo mes, sem data final
  const [fixed, setFixed] = useState(false);
  // Trocar a key refaz os atalhos de data (Salvar e criar nova volta para Hoje)
  const [dateKey, setDateKey] = useState(0);
  const amountInput = useRef<HTMLInputElement>(null);

  const account = accountOf(ctx, state.accountId);
  const currency = account?.currency_code ?? "BRL";
  const places = placesOf(currency, ctx.places);
  const other = foreignAccount(state, ctx);
  const submitting = create.isPending || update.isPending || createRecurrence.isPending;

  // Contas ativas, mais as do lancamento caso tenham sido arquivadas
  const selectable = ctx.accounts.filter((a) => a.active || a.id === state.accountId || a.id === state.counterpartyAccountId);
  const symbol = currencies.find((item) => item.code === currency)?.symbol ?? currency;
  const accountCurrencies = Array.from(new Set(selectable.map((a) => a.currency_code))).sort();
  // So conta com algum digito diferente de zero (o campo formata sozinho: "0,00" e vazio, "12,50" e valor)
  const amountFilled = /[1-9]/.test(state.amount);

  const chipOf = (option: (typeof selectable)[number]): ChipOption => ({
    value: option.id,
    label: `${option.name}${option.active ? "" : ` ${t("transactions.transactionFormDialog.arquivada")}`}`,
    hint: option.currency_code !== "BRL" ? option.currency_code : undefined,
    leading: <CategoryIcon icon={Landmark} color={option.color} />,
  });
  const originChips = selectable.map(chipOf);
  // A conta de destino nunca e a de origem
  const destinationChips = selectable.filter((a) => a.id !== state.accountId).map(chipOf);

  const defaultDescription = (from: string, to: string) =>
    from && to ? t("transactions.transferForm.defaultDescription", { from, to }) : t("transactions.transferForm.defaultDescriptionShort");
  const currentDefault = defaultDescription(account?.name ?? "", accountOf(ctx, state.counterpartyAccountId)?.name ?? "");

  // Ao editar uma transferencia com tags, nota ou descricao propria, abre direto em "Mais detalhes"
  useEffect(() => {
    if (!initial?.ok) return;
    const own = initial.state.description.trim();
    if (initial.state.tagIds.length > 0 || initial.state.notes !== "" || (own !== "" && own !== currentDefault)) {
      setShowDetails(true);
    }
    // So na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Trocar a origem: o valor que chega muda de moeda, e o destino nao pode ser a propria origem
  function chooseOrigin(accountId: string) {
    patch(
      {
        accountId,
        foreignAmount: "",
        ...(state.counterpartyAccountId === accountId ? { counterpartyAccountId: "" } : {}),
      },
      "accountId",
      "foreignAmount",
    );
  }

  function chooseDestination(accountId: string) {
    patch({ counterpartyAccountId: accountId, foreignAmount: "" }, "counterparty", "foreignAmount");
  }

  // A moeda do lancamento e a da conta de origem: escolher outra moeda leva para a primeira conta ativa dela
  function chooseCurrency(code: string) {
    if (code === currency) return;
    const inCurrency = selectable.filter((a) => a.currency_code === code && a.active);
    const next = inCurrency.find((a) => a.type === "asset") ?? inCurrency[0];
    if (next) chooseOrigin(next.id);
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
    setState(emptyForm(ctx, { kind: "transfer", accountId: state.accountId }));
    setErrors({});
    setFixed(false);
    setDateKey((current) => current + 1);
    amountInput.current?.focus();
  }

  async function save(andNew: boolean) {
    if (submitting) return;
    setFormError(null);

    // Sem descricao propria vale "Origem -> Destino": o campo mora em "Mais detalhes" e nao pode travar o salvar
    const effective: FormState = { ...state, description: state.description.trim() || currentDefault };
    const found = validateForm(effective, ctx);
    setErrors(found);
    if (hasErrors(found)) {
      const order: [keyof FormErrors, string][] = [
        ["amount", "tx-amount"],
        ["date", "tx-date"],
        ["accountId", "tx-account"],
        ["counterparty", "tx-counterparty"],
        ["foreignAmount", "tx-foreign-amount"],
      ];
      const first = order.find(([field]) => found[field]);
      if (first) document.getElementById(first[1])?.focus();
      return;
    }

    try {
      const body = buildPayload(effective, ctx);
      if (!editing && fixed) {
        await createRecurrence.mutateAsync({
          name: effective.description,
          auto_create: true,
          frequency: "monthly",
          first_date: state.date,
          template: body,
          end_date: null,
          max_occurrences: null,
        });
      } else if (transaction) {
        await update.mutateAsync({ id: transaction.id, body });
      } else {
        await create.mutateAsync(body);
      }
      if (andNew && !editing) resetForNext();
      else onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  const leftColumn = (
    <div className="flex min-w-0 flex-col gap-4">
      <FormField id="tx-amount" hideLabel label={t("transactions.form.amount", { currency })} error={errors.amount}>
        {(props) => (
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xl font-semibold text-primary-text">
              {symbol}
            </span>
            <MoneyInput
              {...props}
              ref={amountInput}
              placeholder="0,00"
              places={places}
              value={state.amount}
              onChange={(text) => patch({ amount: text }, "amount")}
              onBlur={() => {
                if (!amountFilled) setErrors((current) => ({ ...current, amount: t("money.required") }));
              }}
              className={cn(UNDERLINED, "h-10 text-xl font-semibold text-primary-text placeholder:text-primary-text")}
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

      <DateChips
        key={dateKey}
        value={state.date}
        onChange={(date) => patch({ date }, "date")}
        activeClassName="bg-primary text-primary-foreground"
        error={errors.date}
      />

      <Row icon={ArrowUpFromLine}>
        <FormField id="tx-account" hideLabel label={t("transactions.transferForm.from")} error={errors.accountId}>
          {(props) => (
            <ChipSelect
              {...props}
              value={state.accountId}
              options={originChips}
              placeholder={t("transactions.transferForm.from")}
              onChange={chooseOrigin}
            />
          )}
        </FormField>
      </Row>

      <Row icon={ArrowDownToLine}>
        <FormField id="tx-counterparty" hideLabel label={t("transactions.transferForm.to")} error={errors.counterparty}>
          {(props) => (
            <ChipSelect
              {...props}
              value={state.counterpartyAccountId}
              options={destinationChips}
              placeholder={t("transactions.transferForm.to")}
              onChange={chooseDestination}
            />
          )}
        </FormField>
      </Row>

      {other && (
        <FormField
          id="tx-foreign-amount"
          label={t("transactions.form.arrivingAmount", { currency: other.currency_code })}
          error={errors.foreignAmount}
        >
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
      <TagPicker tags={tags} selected={state.tagIds} label={t("transactions.transactionFormDialog.tags")} onChange={(next) => patch({ tagIds: next })} />

      <FormField id="tx-notes" label={t("transactions.transactionFormDialog.notas")}>
        {(props) => <Textarea {...props} value={state.notes} onChange={(e) => patch({ notes: e.target.value })} />}
      </FormField>

      {!editing && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span id="trf-fixed-label" className="text-sm">
              {t("transactions.transferForm.fixed")}
            </span>
            <Switch checked={fixed} onCheckedChange={setFixed} aria-labelledby="trf-fixed-label" />
          </div>
          {fixed && <p className="text-xs text-muted-foreground">{t("transactions.expenseForm.fixedHint")}</p>}
        </div>
      )}

      <FormField id="tx-description" label={t("common.descricao")} hint={t("transactions.transferForm.descriptionHint")}>
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            placeholder={currentDefault}
            value={state.description}
            onChange={(e) => patch({ description: e.target.value }, "description")}
          />
        )}
      </FormField>
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
        {leftColumn}
        {showDetails && details}
      </div>

      <DialogFooter>
        {!editing && (
          <Button type="button" variant="ghost" disabled={submitting || !amountFilled} onClick={() => void save(true)}>
            {t("transactions.expenseForm.saveAndNew")}
          </Button>
        )}
        <Button type="submit" disabled={submitting || !amountFilled}>
          {submitting ? t("transactions.transactionFormDialog.salvando") : t("transactions.transactionFormDialog.salvar")}
        </Button>
      </DialogFooter>
    </form>
  );
}

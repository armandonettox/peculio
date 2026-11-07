import { X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useCreateBudget, useUpdateBudget, type Budget, type BudgetCreate, type BudgetPeriod, type BudgetUpdate } from "@/api/budgets";
import { useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
import { useCategories } from "@/api/labels";
import { useAuth } from "@/auth/auth-context";
import { requiredError } from "@/auth/validation";
import { FormField } from "@/components/form-field";
import { MoneyInput } from "@/components/money-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CategoryIcon } from "@/features/labels/category-icon";
import { parseMoneyInput, placesOf } from "@/lib/money";
import { periodLabel, PERIODS } from "./presentation";
import { useTranslation } from "react-i18next";

type Field = "name" | "amount" | "start_date" | "end_date";
type Errors = Partial<Record<Field, string>>;
const FIELD_ORDER: Field[] = ["name", "amount", "start_date", "end_date"];

// O backend usa ponto nos centavos; na tela mostramos virgula
const toInputText = (value: string) => value.replace(".", ",");

const SERVER_FIELDS: Record<string, Field> = { name: "name", amount: "amount", start_date: "start_date", end_date: "end_date" };

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

type Props = {
  // Sem `budget` o dialogo cria; com `budget` edita
  budget?: Budget;
  onClose: () => void;
};

export function BudgetFormDialog({ budget, onClose }: Props) {
  const { t } = useTranslation();
  const editing = budget !== undefined;
  const { user } = useAuth();
  const currencies = useCurrencies();
  const categories = useCategories({ search: "", kind: "expense" });
  const create = useCreateBudget();
  const update = useUpdateBudget();

  const [name, setName] = useState(budget?.name ?? "");
  const [currency, setCurrency] = useState(budget?.currency_code ?? user?.default_currency ?? "BRL");
  const [amount, setAmount] = useState(budget ? toInputText(budget.amount) : "");
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? "monthly");
  const [startDate, setStartDate] = useState(budget?.start_date ?? "");
  const [endDate, setEndDate] = useState(budget?.end_date ?? "");
  const [categoryIds, setCategoryIds] = useState<string[]>(budget?.category_ids ?? []);
  const [alert, setAlert] = useState(budget?.alert ?? false);
  const [carryOver, setCarryOver] = useState(budget?.carry_over ?? false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const placesMap = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const places = placesOf(currency, placesMap);
  const submitting = create.isPending || update.isPending;
  const isCustom = period === "custom";

  const byId = new Map((categories.data?.items ?? []).map((item) => [item.id, item]));
  const available = (categories.data?.items ?? []).filter((item) => !categoryIds.includes(item.id));

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function toggleCarryOver(checked: boolean) {
    setCarryOver(checked);
    if (checked) setPeriod("monthly");
  }

  function changePeriod(next: BudgetPeriod) {
    setPeriod(next);
    // Sobra so vale mes a mes, e o personalizado nao se repete
    if (next !== "monthly") setCarryOver(false);
  }

  function handleServerError(error: unknown) {
    const message = getErrorMessage(error);
    if (!(error instanceof ApiError)) return setFormError(message);

    const serverErrors: Errors = {};
    for (const item of error.fieldErrors) {
      const field = SERVER_FIELDS[item.field];
      if (field) serverErrors[field] = item.message;
    }
    if (error.code === "budget_name_taken") serverErrors.name = message;
    if (error.code === "invalid_amount") serverErrors.amount = message;

    setErrors(serverErrors);
    const first = FIELD_ORDER.find((field) => serverErrors[field]);
    if (first) document.getElementById(`budget-${first}`)?.focus();
    if (!first || error.code === "validation_error") setFormError(message);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const found: Errors = { name: requiredError(name, t("budgets.budgetFormDialog.informeONome")) };
    let amountValue = "";
    const parsed = parseMoneyInput(amount, places);
    if (amount.trim() === "") found.amount = t("budgets.budgetFormDialog.informeOValorDoLimite");
    else if (!parsed.ok) found.amount = parsed.error;
    else if (/^0+(\.0+)?$/.test(parsed.value) || parsed.value.startsWith("-")) {
      found.amount = t("budgets.budgetFormDialog.informeUmValorMaior");
    } else amountValue = parsed.value;

    if (isCustom) {
      if (!startDate) found.start_date = t("budgets.budgetFormDialog.informeADataInicial");
      if (!endDate) found.end_date = t("budgets.budgetFormDialog.informeADataFinal");
      else if (startDate && endDate < startDate) found.end_date = t("budgets.budgetFormDialog.dataFinalAntes");
    }

    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`budget-${firstInvalid}`)?.focus();
      return;
    }

    try {
      if (!editing) {
        const body: BudgetCreate = {
          name: name.trim(),
          currency_code: currency,
          amount: amountValue,
          period,
          carry_over: carryOver,
          category_ids: categoryIds,
          alert,
          ...(isCustom ? { start_date: startDate, end_date: endDate } : {}),
        };
        await create.mutateAsync(body);
      } else {
        // Manda so o que mudou, para nao sobrescrever sem querer
        const body: BudgetUpdate = {};
        if (name.trim() !== budget.name) body.name = name.trim();
        if (amountValue !== budget.amount) body.amount = amountValue;
        if (period !== budget.period) body.period = period;
        if (isCustom && (startDate !== budget.start_date || endDate !== budget.end_date || period !== budget.period)) {
          body.start_date = startDate;
          body.end_date = endDate;
        }
        if (carryOver !== budget.carry_over) body.carry_over = carryOver;
        if (alert !== budget.alert) body.alert = alert;
        if (!sameIds(categoryIds, budget.category_ids)) body.category_ids = categoryIds;
        if (Object.keys(body).length > 0) await update.mutateAsync({ id: budget.id, body });
      }
      onClose();
    } catch (error) {
      handleServerError(error);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent fullOnMobile>
        <DialogHeader>
          <DialogTitle>{editing ? t("budgets.budgetFormDialog.editarOrcamento") : t("budgets.budgetFormDialog.novoOrcamento")}</DialogTitle>
          <DialogDescription>
            {editing ? t("budgets.budgetFormDialog.mudarOValorOu") : t("budgets.budgetFormDialog.umLimiteDeGasto")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="budget-name" label={t("common.nome")} error={errors.name}>
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
            <FormField id="budget-currency" label={t("common.moeda")}>
              {(props) => (
                <Select {...props} value={currency} disabled={editing} onChange={(event) => setCurrency(event.target.value)}>
                  {/* Enquanto a lista carrega, mostra so a moeda atual */}
                  {(currencies.data ?? [{ code: currency, name: currency }]).map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} - {option.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField id="budget-period" label={t("common.periodo")}>
              {(props) => (
                <Select {...props} value={period} disabled={carryOver} onChange={(event) => changePeriod(event.target.value as BudgetPeriod)}>
                  {PERIODS.map((option) => (
                    <option key={option} value={option}>
                      {periodLabel(option)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>

          {isCustom && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="budget-start_date" label={t("budgets.budgetFormDialog.dataInicial")} error={errors.start_date}>
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={startDate}
                    onChange={(event) => {
                      setStartDate(event.target.value);
                      clearError("start_date");
                    }}
                  />
                )}
              </FormField>
              <FormField id="budget-end_date" label={t("budgets.budgetFormDialog.dataFinal")} error={errors.end_date}>
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={endDate}
                    onChange={(event) => {
                      setEndDate(event.target.value);
                      clearError("end_date");
                    }}
                  />
                )}
              </FormField>
            </div>
          )}

          <FormField
            id="budget-amount"
            label={isCustom ? t("budgets.budgetFormDialog.limiteDoPeriodo") : t("budgets.budgetFormDialog.limitePorPeriodo")}
            error={errors.amount}
          >
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

          <div className="flex flex-col gap-2">
            <label htmlFor="budget-categories" className="text-sm font-medium">
              {t("budgets.budgetFormDialog.categorias")}
            </label>
            <p className="-mt-1 text-xs text-muted-foreground">{t("budgets.budgetFormDialog.categoriasTexto")}</p>
            {categoryIds.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {categoryIds.map((id) => {
                  const category = byId.get(id);
                  return (
                    <li key={id} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-1 pr-1.5 text-xs">
                      <CategoryIcon name={category?.icon} color={category?.color} className="size-5" />
                      {category?.name}
                      <button
                        type="button"
                        aria-label={t("budgets.budgetFormDialog.tirarCategoria", { name: category?.name ?? "" })}
                        onClick={() => setCategoryIds((current) => current.filter((item) => item !== id))}
                        className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <Select
              id="budget-categories"
              value=""
              disabled={available.length === 0}
              onChange={(event) => event.target.value && setCategoryIds((current) => [...current, event.target.value])}
            >
              <option value="">
                {available.length === 0 ? t("budgets.budgetFormDialog.semMaisCategorias") : t("budgets.budgetFormDialog.escolhaUmaCategoria")}
              </option>
              {available.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <span id="budget-alert-label" className="text-sm font-medium">
                {t("budgets.budgetFormDialog.receberAlerta")}
              </span>
              <p className="text-xs text-muted-foreground">{t("budgets.budgetFormDialog.receberAlertaTexto")}</p>
            </div>
            <Switch checked={alert} onCheckedChange={setAlert} aria-labelledby="budget-alert-label" />
          </div>

          <label className={`flex items-start gap-2 text-sm ${isCustom ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              checked={carryOver}
              disabled={isCustom}
              onChange={(event) => toggleCarryOver(event.target.checked)}
              className="mt-0.5 accent-[var(--primary)]"
            />
            <span>
              <span className="font-medium">{t("budgets.budgetFormDialog.carregarSobra")}</span>
              <span className="block text-xs text-muted-foreground">
                {isCustom ? t("budgets.budgetFormDialog.carregarSobraSoMensal") : t("budgets.budgetFormDialog.carregarSobraTexto")}
              </span>
            </span>
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("budgets.budgetFormDialog.salvando") : editing ? t("budgets.budgetFormDialog.salvar") : t("budgets.budgetFormDialog.criarOrcamento")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

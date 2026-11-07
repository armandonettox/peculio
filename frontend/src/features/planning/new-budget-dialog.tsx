import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { useCategories } from "@/api/labels";
import { usePutPlanItems, type MonthlyPlan, type PlanRow } from "@/api/plans";
import { useReportGrouped } from "@/api/reports";
import { MoneyInput } from "@/components/money-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CategoryIcon } from "@/features/labels/category-icon";
import { formatMoney, parseMoneyInput, placesOf } from "@/lib/money";
import { cn } from "@/lib/utils";
import { lastOfMonth, monthKey, shiftMonthKey, monthStart } from "./presentation";

type Props = {
  plan: MonthlyPlan;
  // Uma linha existente: abre para editar so esse limite
  editing?: PlanRow;
  onClose: () => void;
};

/**
 * Novo orcamento: escolhe uma ou mais categorias, define o limite de cada uma e, se quiser, liga o alerta. Mostra o
 * quanto sobra para as categorias restantes enquanto a pessoa digita. Com `editing`, muda so o limite dessa categoria.
 */
export function NewBudgetDialog({ plan, editing, onClose }: Props) {
  const { t } = useTranslation();
  const month = monthKey(plan.month);
  const currencies = useCurrencies();
  const categories = useCategories({ search: "", kind: "expense" });
  const put = usePutPlanItems();

  // O que se gastou em cada categoria no mes anterior, como referencia para escolher o limite
  const previous = shiftMonthKey(month, -1);
  const previousSpending = useReportGrouped("category", {
    dateFrom: monthStart(previous),
    dateTo: lastOfMonth(monthStart(previous)),
  });

  const places = placesOf(
    plan.currency_code,
    Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places])),
  );
  const money = (value: string | number) => formatMoney(typeof value === "number" ? value.toFixed(places) : value, plan.currency_code);

  const [selected, setSelected] = useState<string[]>(editing?.category_id ? [editing.category_id] : []);
  const [limits, setLimits] = useState<Record<string, string>>(
    editing?.category_id ? { [editing.category_id]: editing.planned.replace(".", ",") } : {},
  );
  const [alert, setAlert] = useState(editing?.alert ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);

  const taken = new Set(plan.rows.filter((row) => row.kind === "category").map((row) => row.category_id));
  const available = (categories.data?.items ?? []).filter((item) => !taken.has(item.id) && !selected.includes(item.id));
  const byId = useMemo(() => new Map((categories.data?.items ?? []).map((item) => [item.id, item])), [categories.data]);
  const spentBefore = useMemo(() => {
    const block = previousSpending.data?.currencies.find((item) => item.currency_code === plan.currency_code);
    return new Map((block?.rows ?? []).map((item) => [item.id, item.expense]));
  }, [previousSpending.data, plan.currency_code]);

  // O limite digitado como texto da API ("1500.00"), ou null se o campo esta vazio ou invalido
  const apiValue = (id: string): string | null => {
    const parsed = parseMoneyInput(limits[id] ?? "", places);
    return parsed.ok ? parsed.value : null;
  };
  const amountOf = (id: string): number => Number(apiValue(id) ?? 0);
  const budget = Number(plan.spending_budget);
  // O que ja esta limitado em outras categorias do plano (a linha editada sai da conta: ela mesma muda)
  const others = plan.rows
    .filter((row) => row.kind === "category" && row.category_id !== editing?.category_id)
    .reduce((total, row) => total + Number(row.planned), 0);
  const typed = selected.reduce((total, id) => total + amountOf(id), 0);
  const rest = budget - others - typed;
  const overBudget = rest < -1e-9;
  const canSave = selected.some((id) => amountOf(id) > 0) && !overBudget && !put.isPending;

  function addCategory(id: string) {
    if (id) setSelected((current) => [...current, id]);
  }

  function removeCategory(id: string) {
    setSelected((current) => current.filter((item) => item !== id));
  }

  async function save(andNew: boolean) {
    if (!canSave) return;
    setError(null);
    try {
      const items = selected
        .filter((id) => amountOf(id) > 0)
        .map((id) => ({ category_id: id, amount: apiValue(id) ?? "0", alert }));
      await put.mutateAsync({ month, items });
      if (andNew && !editing) {
        setSelected([]);
        setLimits({});
        setAlert(false);
        setSaved((count) => count + 1);
      } else {
        onClose();
      }
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !put.isPending && onClose()}>
      <DialogContent fullOnMobile className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("planning.newBudget.editTitle") : t("planning.newBudget.title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("planning.newBudget.description")}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
          className="flex flex-col gap-4"
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          {saved > 0 && !error && (
            <p role="status" className="text-xs text-muted-foreground">
              {t("planning.newBudget.savedHint", { count: saved })}
            </p>
          )}

          {!editing && (
            <div className="flex flex-col gap-2">
              <label htmlFor="plan-add-category" className="text-sm font-medium">
                {t("planning.newBudget.categories")}
              </label>
              {selected.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {selected.map((id) => {
                    const category = byId.get(id);
                    return (
                      <li key={id} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-1 pr-1.5 text-xs">
                        <CategoryIcon name={category?.icon} color={category?.color} className="size-5" />
                        {category?.name}
                        <button
                          type="button"
                          aria-label={t("planning.newBudget.removeCategory", { name: category?.name ?? "" })}
                          onClick={() => removeCategory(id)}
                          className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Select id="plan-add-category" value="" onChange={(event) => addCategory(event.target.value)} disabled={available.length === 0}>
                <option value="">{available.length === 0 ? t("planning.newBudget.noCategories") : t("planning.newBudget.chooseCategory")}</option>
                {available.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {selected.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                <span className="text-sm text-muted-foreground">{t("planning.newBudget.total")}</span>
                <span className="text-xl font-semibold tabular-nums">{money(plan.spending_budget)}</span>
              </div>
              <ul className="flex flex-col gap-3">
                {selected.map((id) => {
                  const category = byId.get(id);
                  const before = spentBefore.get(id) ?? "0.00";
                  return (
                    <li key={id} className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <CategoryIcon name={category?.icon} color={category?.color} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">{category?.name}</span>
                          <span className="text-xs text-muted-foreground">{t("planning.newBudget.previousSpent", { value: money(before) })}</span>
                        </span>
                      </span>
                      <MoneyInput
                        aria-label={t("planning.newBudget.limitFor", { name: category?.name ?? "" })}
                        placeholder="0,00"
                        places={places}
                        value={limits[id] ?? ""}
                        onChange={(text) => setLimits((current) => ({ ...current, [id]: text }))}
                        className="w-32 text-right"
                      />
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between gap-3 border-t pt-3">
                <span className="text-sm font-medium">{t("planning.newBudget.rest")}</span>
                <span className={cn("text-sm font-semibold tabular-nums", overBudget && "text-destructive")}>{money(rest)}</span>
              </div>
              {overBudget && (
                <p role="alert" className="text-xs text-destructive">
                  {t("planning.newBudget.overBudget")}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span id="plan-alert-label" className="text-sm">
              {t("planning.newBudget.alert")}
            </span>
            <Switch checked={alert} onCheckedChange={setAlert} aria-labelledby="plan-alert-label" />
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{t("planning.newBudget.alertHint")}</p>

          <DialogFooter>
            {!editing && (
              <Button type="button" variant="ghost" disabled={!canSave} onClick={() => void save(true)}>
                {t("planning.newBudget.saveAndNew")}
              </Button>
            )}
            <Button type="submit" disabled={!canSave}>
              {put.isPending ? t("planning.saving") : t("planning.newBudget.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

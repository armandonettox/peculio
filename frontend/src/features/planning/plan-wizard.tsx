import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { useCategories, type Category } from "@/api/labels";
import {
  useCreateMonthlyPlan,
  useDeletePlanItem,
  useMonthlyPlan,
  usePutPlanItems,
  useUpdateMonthlyPlan,
  type CardCounting,
  type MonthlyPlan,
} from "@/api/plans";
import { useReportGrouped } from "@/api/reports";
import { useAuth } from "@/auth/auth-context";
import { MoneyInput } from "@/components/money-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CategoryIcon } from "@/features/labels/category-icon";
import { appToday, formatMonthYear } from "@/lib/dates";
import { formatMoney, parseMoneyInput, placesOf } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CardCountingChoice } from "./card-counting-dialog";
import { monthKey, monthStart } from "./presentation";

type Step = "income" | "categories" | "card" | "done";
const STEPS: Exclude<Step, "done">[] = ["income", "categories", "card"];

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** So digitos e um ponto, de 0 a 100 (a virgula vira ponto): a porcentagem que a pessoa quer economizar. */
function cleanPercent(raw: string): string {
  let text = raw.replace(",", ".").replace(/[^\d.]/g, "");
  const dot = text.indexOf(".");
  if (dot >= 0) text = text.slice(0, dot + 1) + text.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  if (Number(text) > 100) text = "100";
  return text;
}

type BodyProps = {
  month: string;
  plan: MonthlyPlan | null;
  categories: Category[];
  // Categorias que a pessoa mais usou: ja vem marcadas ao criar um planejamento
  suggested: string[];
  currencyCode: string;
};

function WizardBody({ month, plan, categories, suggested, currencyCode }: BodyProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Fixo desde que o assistente abre: ao criar, o plano recarrega e passa a existir, mas a tela final ainda e de "criou"
  const [editing] = useState(plan !== null);
  const currencies = useCurrencies();
  const places = placesOf(currencyCode, Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places])));
  const money = (value: number) => formatMoney(value.toFixed(places), currencyCode);

  const create = useCreateMonthlyPlan();
  const update = useUpdateMonthlyPlan();
  const putItems = usePutPlanItems();
  const removeItem = useDeletePlanItem();
  const busy = create.isPending || update.isPending || putItems.isPending || removeItem.isPending;

  const [step, setStep] = useState<Step>("income");
  const [income, setIncome] = useState(plan?.income ?? "");
  const [savings, setSavings] = useState(plan ? String(Number(plan.savings_percent)) : "20");
  const [selected, setSelected] = useState<string[]>(
    plan ? plan.rows.filter((row) => row.kind === "category").map((row) => row.category_id!) : suggested,
  );
  const [limits, setLimits] = useState<Record<string, string>>(
    plan ? Object.fromEntries(plan.rows.filter((row) => row.kind === "category").map((row) => [row.category_id!, row.planned])) : {},
  );
  const [cardCounting, setCardCounting] = useState<CardCounting>(plan?.card_counting ?? "purchase");
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiValue = (text: string): string | null => {
    const parsed = parseMoneyInput(text, places);
    return parsed.ok ? parsed.value : null;
  };
  const incomeValue = Number(apiValue(income) ?? 0);
  const savingsValue = Number(savings || 0);
  const budget = Math.round(incomeValue * (100 - savingsValue)) / 100;
  const saved = incomeValue - budget;
  const limitOf = (id: string) => Number(apiValue(limits[id] ?? "") ?? 0);
  const categorized = selected.reduce((total, id) => total + limitOf(id), 0);
  const over = categorized - budget > 1e-9;
  const byId = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const monthLabel = formatMonthYear(monthStart(month));

  function back() {
    if (step === "income") navigate(`/orcamentos?mes=${month}`);
    else setStep(step === "card" ? "categories" : "income");
  }

  async function finish() {
    setError(null);
    const items = selected
      .filter((id) => limitOf(id) > 0)
      .map((id) => ({ category_id: id, amount: apiValue(limits[id] ?? "") ?? "0", alert: plan?.rows.find((row) => row.category_id === id)?.alert ?? false }));
    const header = { income: apiValue(income) ?? "0", savings_percent: savings || "0", card_counting: cardCounting };
    try {
      if (!plan) {
        await create.mutateAsync({ month, body: { ...header, items } });
      } else {
        const keep = new Set(items.map((item) => item.category_id));
        const removed = plan.rows.filter((row) => row.kind === "category" && !keep.has(row.category_id!));
        // A ordem evita um estado invalido no meio: se o orcamento novo cabe no antigo, mexe nos limites primeiro
        // (tirando antes de pôr); senao sobe o orcamento antes dos limites
        const limitsFirst = categorized <= Number(plan.spending_budget) + 1e-9;
        const applyItems = async () => {
          for (const row of removed) await removeItem.mutateAsync({ month, categoryId: row.category_id! });
          if (items.length > 0) await putItems.mutateAsync({ month, items });
        };
        if (limitsFirst) {
          await applyItems();
          await update.mutateAsync({ month, body: header });
        } else {
          await update.mutateAsync({ month, body: header });
          await applyItems();
        }
      }
      setStep("done");
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  if (step === "done") {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-lg border bg-card px-6 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-positive/15 text-positive">
          <Check className="size-7" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold">{t("planning.wizard.doneTitle")}</h2>
        <p className="font-medium">{editing ? t("planning.wizard.doneEdited") : t("planning.wizard.doneCreated")}</p>
        <p className="text-sm text-muted-foreground">{t("planning.wizard.doneText", { month: monthLabel })}</p>
        <Button onClick={() => navigate(`/orcamentos?mes=${month}`)}>{t("planning.wizard.viewPlan")}</Button>
      </div>
    );
  }

  const current = STEPS.indexOf(step);
  const crumbs = (
    <ol className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label={t("planning.wizard.stepsLabel")}>
      {STEPS.map((id, index) => (
        <li key={id} aria-current={index === current ? "step" : undefined} className={cn(index === current ? "font-semibold" : "text-muted-foreground")}>
          {index > 0 && <span aria-hidden="true"> / </span>}
          {t(`planning.wizard.steps.${id}`)}
        </li>
      ))}
    </ol>
  );

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center gap-2">
        <Button size="icon" variant="ghost" className="size-8" aria-label={t("planning.wizard.back")} onClick={back} disabled={busy}>
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="text-lg font-semibold">
          {editing ? t("planning.wizard.editTitle") : t("planning.wizard.title")}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{monthLabel}</span>
        </h2>
      </div>
      {crumbs}

      {step === "income" && (
        <section className="flex max-w-3xl flex-col gap-6 rounded-lg border bg-card p-6">
          <div className="flex flex-col gap-2">
            <label htmlFor="plan-income" className="font-medium">
              {t("planning.wizard.incomeQuestion")}
            </label>
            <MoneyInput
              id="plan-income"
              placeholder="0,00"
              places={places}
              value={income}
              onChange={setIncome}
              className="h-11 max-w-xs text-xl font-semibold text-primary-text"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="plan-savings" className="font-medium">
              {t("planning.wizard.savingsQuestion")}
            </label>
            <p id="plan-savings-hint" className="text-sm text-muted-foreground">
              {t("planning.wizard.savingsHint")}
            </p>
            <div className="flex items-center gap-2">
              <Input
                id="plan-savings"
                aria-describedby="plan-savings-hint"
                inputMode="decimal"
                autoComplete="off"
                value={savings}
                onChange={(event) => setSavings(cleanPercent(event.target.value))}
                className="h-11 w-24 text-xl font-semibold text-primary-text"
              />
              <span aria-hidden="true" className="text-sm font-medium text-primary-text">
                %
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-lg bg-primary/10 p-4" aria-live="polite">
            <p className="text-sm text-foreground">{t("planning.wizard.yourBudget")}</p>
            <p className="text-2xl font-semibold tabular-nums">{money(budget)}</p>
            <p className="mt-2 text-sm text-foreground">{t("planning.wizard.youSave")}</p>
            <p className="text-xl font-semibold tabular-nums text-positive">{money(saved)}</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setStep("categories")} disabled={!(incomeValue > 0)} aria-label={t("planning.wizard.next")}>
              <ArrowRight />
            </Button>
          </div>
        </section>
      )}

      {step === "categories" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="flex flex-col gap-4 rounded-lg border bg-card p-6">
            <div>
              <h3 className="font-semibold">{t("planning.wizard.planHeading")}</h3>
              <p className="text-sm text-muted-foreground">{t("planning.wizard.planHint")}</p>
            </div>
            <h4 className="font-medium">{t("planning.wizard.categoriesTitle")}</h4>
            {selected.length === 0 ? (
              <p role="status" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {categories.length === 0 ? t("planning.wizard.noCategoriesYet") : t("planning.wizard.nothingSelected")}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {selected.map((id) => {
                  const category = byId.get(id);
                  return (
                    <li key={id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <CategoryIcon name={category?.icon} color={category?.color} className="size-8" />
                        <span className="truncate text-sm font-medium">{category?.name}</span>
                      </span>
                      <MoneyInput
                        aria-label={t("planning.wizard.limit", { name: category?.name ?? "" })}
                        placeholder="0,00"
                        places={places}
                        value={limits[id] ?? ""}
                        onChange={(text) => setLimits((current) => ({ ...current, [id]: text }))}
                        className="w-36 text-right font-semibold text-primary-text"
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {error && <Alert variant="destructive">{error}</Alert>}
            <div className="flex justify-end">
              <Button onClick={() => setStep("card")} disabled={!(categorized > 0) || over} aria-label={t("planning.wizard.next")}>
                <ArrowRight />
              </Button>
            </div>
          </section>

          <aside className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              <div className="flex items-center gap-4">
                <Donut fraction={budget > 0 ? categorized / budget : 0} over={over} />
                <div>
                  <p className="text-xs text-muted-foreground">{t("planning.wizard.categorized")}</p>
                  <p className="text-lg font-semibold tabular-nums">{money(categorized)}</p>
                  <p className={cn("text-xs", over ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {over
                      ? t("planning.wizard.overBudget", { value: money(categorized - budget) })
                      : t("planning.wizard.uncategorized", { value: money(budget - categorized) })}
                  </p>
                </div>
              </div>
              <p className="rounded-md bg-primary/10 p-3 text-xs text-foreground">{t("planning.wizard.tip")}</p>
            </div>
            <Button variant="ghost" className="self-center text-primary-text" onClick={() => setManaging(true)}>
              {t("planning.wizard.manage")}
            </Button>
          </aside>
        </div>
      )}

      {step === "card" && (
        <section className="flex max-w-3xl flex-col gap-4 rounded-lg border bg-card p-6">
          <div>
            <h3 className="font-semibold">{t("planning.card.question")}</h3>
            <p className="text-sm text-muted-foreground">{t("planning.card.hint")}</p>
          </div>
          <CardCountingChoice value={cardCounting} onChange={setCardCounting} name="wizard-card-counting" />
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex justify-end">
            <Button onClick={() => void finish()} disabled={busy}>
              {busy ? t("planning.saving") : t("planning.wizard.finish")}
            </Button>
          </div>
        </section>
      )}

      {managing && (
        <ManageCategories
          categories={categories}
          selected={selected}
          onApply={(next) => {
            setSelected(next);
            setManaging(false);
          }}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

/** Rosca do quanto do orcamento ja esta distribuido em categorias. So o desenho: os valores estao ao lado, em texto. */
function Donut({ fraction, over }: { fraction: number; over: boolean }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.min(Math.max(fraction, 0), 1) * circumference;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="8" className="stroke-muted" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        className={over ? "stroke-destructive" : "stroke-primary"}
      />
    </svg>
  );
}

/** Marca quais categorias de gasto entram no planejamento. */
function ManageCategories({
  categories,
  selected,
  onApply,
  onClose,
}: {
  categories: Category[];
  selected: string[];
  onApply: (next: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState<string[]>(selected);

  function toggle(id: string) {
    setChecked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  // Quem ja estava mantem a ordem; as novas entram no fim
  const next = [...selected.filter((id) => checked.includes(id)), ...checked.filter((id) => !selected.includes(id))];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("planning.wizard.manageTitle")}</DialogTitle>
          <DialogDescription>{t("planning.wizard.manageHint")}</DialogDescription>
        </DialogHeader>
        {categories.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("planning.wizard.noCategoriesYet")}
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {categories.map((category) => (
              <li key={category.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input
                    type="checkbox"
                    checked={checked.includes(category.id)}
                    onChange={() => toggle(category.id)}
                    className="accent-[var(--primary)]"
                  />
                  <CategoryIcon name={category.icon} color={category.color} />
                  <span className="text-sm">{category.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancelar")}
          </Button>
          <Button type="button" onClick={() => onApply(next)}>
            {t("planning.wizard.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O assistente do planejamento mensal: renda e economia, limite por categoria e como contar o cartao. */
export function PlanWizard() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const raw = params.get("mes");
  const month = raw && MONTH_PATTERN.test(raw) ? raw : monthKey(appToday());

  const planQuery = useMonthlyPlan(month);
  const categoriesQuery = useCategories({ search: "", kind: "expense" });
  const history = useReportGrouped("category", { period: "last-3-months" });

  if (planQuery.isError || categoriesQuery.isError) {
    return <Alert variant="destructive">{getErrorMessage(planQuery.error ?? categoriesQuery.error)}</Alert>;
  }
  if (planQuery.isPending || categoriesQuery.isPending || history.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("planning.loading")}
      </p>
    );
  }

  const categories = categoriesQuery.data.items;
  const plan = planQuery.data;
  const currencyCode = plan?.currency_code ?? user?.default_currency ?? "BRL";

  // As categorias mais usadas nos ultimos 3 meses ja vem marcadas; sem historico, comeca com as primeiras
  const known = new Set(categories.map((category) => category.id));
  const spent = new Map<string, number>();
  for (const block of history.data?.currencies ?? []) {
    if (block.currency_code !== currencyCode) continue;
    for (const row of block.rows) {
      if (row.id && known.has(row.id) && Number(row.expense) > 0) spent.set(row.id, (spent.get(row.id) ?? 0) + Number(row.expense));
    }
  }
  const used = [...spent.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const suggested = used.length > 0 ? used : categories.slice(0, 6).map((category) => category.id);

  // A chave e so o mes: criar o plano recarrega a consulta e nao pode remontar o assistente no meio do caminho
  return <WizardBody key={month} month={month} plan={plan} categories={categories} suggested={suggested} currencyCode={currencyCode} />;
}

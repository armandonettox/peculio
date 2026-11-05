import { BookmarkCheck, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Account } from "@/api/accounts";
import type { Category, Tag } from "@/api/labels";
import type { TransactionFilters } from "@/api/transactions";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetTitle } from "@/components/ui/sheet";
import { Tab, TabList } from "@/components/ui/tabs";

import type { KindFilter } from "./filters";
import { deleteSavedFilter, loadSavedFilters, saveFilter, type SavedFilter } from "./saved-filters";

type Props = {
  filters: TransactionFilters;
  kind: KindFilter | null;
  minDraft: string;
  maxDraft: string;
  onMinChange: (v: string) => void;
  onMaxChange: (v: string) => void;
  minError?: string;
  maxError?: string;
  dateError?: string;
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  onChange: (patch: Partial<TransactionFilters>) => void;
  onKindChange: (kind: KindFilter | null) => void;
  onClear: () => void;
  onApplySaved: (entry: SavedFilter) => void;
  onClose: () => void;
};


function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function Divider() {
  return <div className="border-t border-border" />;
}

// Aba "Novo filtro"
function NewFilterTab(props: Props) {
  const { t } = useTranslation();
  const { filters, minDraft, maxDraft, accounts, categories, tags } = props;

  const [dateFromDraft, setDateFromDraft] = useState(filters.dateFrom ?? "");
  const [dateToDraft, setDateToDraft] = useState(filters.dateTo ?? "");
  const dateFromTimer = useRef<ReturnType<typeof setTimeout>>();
  const dateToTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setDateFromDraft(filters.dateFrom ?? ""); }, [filters.dateFrom]);
  useEffect(() => { setDateToDraft(filters.dateTo ?? ""); }, [filters.dateTo]);

  const accountOptions = useMemo(() => [
    { value: "", label: t("common.todas") },
    ...accounts.map((a) => ({
      value: a.id,
      label: a.active ? a.name : `${a.name} ${t("transactions.filterBar.arquivada")}`,
    })),
  ], [accounts, t]);

  const categoryOptions = useMemo(() => [
    { value: "", label: t("common.todas") },
    { value: "none", label: t("transactions.filterBar.semCategoria") },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ], [categories, t]);

  const tagOptions = useMemo(() => [
    { value: "", label: t("common.todas") },
    ...tags.map((tg) => ({ value: tg.id, label: tg.name })),
  ], [tags, t]);

  return (
    <div className="space-y-5 px-5 py-4">

      {/* Periodo */}
      <section>
        <SectionLabel>{t("transactions.filterBar.periodo")}</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="filter-date-from" className="mb-1 block text-xs text-muted-foreground">{t("common.dataInicial")}</label>
            <input
              id="filter-date-from"
              type="date"
              value={dateFromDraft}
              onChange={(e) => {
                const v = e.target.value;
                setDateFromDraft(v);
                clearTimeout(dateFromTimer.current);
                dateFromTimer.current = setTimeout(() => props.onChange({ dateFrom: v }), 400);
              }}
              aria-invalid={props.dateError ? true : undefined}
              className={`w-full rounded-md border bg-background px-2.5 py-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring ${props.dateError ? "border-destructive" : "border-input"}`}
            />
          </div>
          <div>
            <label htmlFor="filter-date-to" className="mb-1 block text-xs text-muted-foreground">{t("common.dataFinal")}</label>
            <input
              id="filter-date-to"
              type="date"
              value={dateToDraft}
              onChange={(e) => {
                const v = e.target.value;
                setDateToDraft(v);
                clearTimeout(dateToTimer.current);
                dateToTimer.current = setTimeout(() => props.onChange({ dateTo: v }), 400);
              }}
              className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        {props.dateError && <p className="mt-1 text-xs text-destructive">{props.dateError}</p>}
      </section>

      <Divider />

      {/* Conta */}
      <section>
        <label htmlFor="filter-account" className="mb-2 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t("common.conta")}</label>
        <select
          id="filter-account"
          value={filters.accountId ?? ""}
          onChange={(e) => props.onChange({ accountId: e.target.value })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {accountOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </section>

      {/* Categoria */}
      <section>
        <label htmlFor="filter-category" className="mb-2 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t("common.categoria")}</label>
        <select
          id="filter-category"
          value={filters.categoryId ?? ""}
          onChange={(e) => props.onChange({ categoryId: e.target.value })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {categoryOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </section>

      {/* Tag */}
      <section>
        <label htmlFor="filter-tag" className="mb-2 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t("common.tag")}</label>
        <select
          id="filter-tag"
          value={filters.tagId ?? ""}
          onChange={(e) => props.onChange({ tagId: e.target.value })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {tagOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </section>

      <Divider />

      {/* Valor */}
      <section>
        <SectionLabel>{t("transactions.filterBar.valor")}</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="filter-min" className="mb-1 block text-xs text-muted-foreground">{t("transactions.filterBar.valorMinimo")}</label>
            <MoneyInput id="filter-min" placeholder="0,00" places={2} value={minDraft} onChange={props.onMinChange} aria-invalid={props.minError ? true : undefined} />
            {props.minError && <p className="mt-1 text-xs text-destructive">{props.minError}</p>}
          </div>
          <div>
            <label htmlFor="filter-max" className="mb-1 block text-xs text-muted-foreground">{t("transactions.filterBar.valorMaximo")}</label>
            <MoneyInput id="filter-max" placeholder="0,00" places={2} value={maxDraft} onChange={props.onMaxChange} aria-invalid={props.maxError ? true : undefined} />
            {props.maxError && <p className="mt-1 text-xs text-destructive">{props.maxError}</p>}
          </div>
        </div>
      </section>

    </div>
  );
}

// Aba "Filtros salvos"
function SavedFiltersTab(props: Props) {
  const { t } = useTranslation();
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(loadSavedFilters);
  const [savingName, setSavingName] = useState("");
  const [showInput, setShowInput] = useState(false);

  function handleSave() {
    const name = savingName.trim();
    if (!name) return;
    saveFilter(name, props.filters, props.kind);
    setSavedFilters(loadSavedFilters());
    setSavingName("");
    setShowInput(false);
  }

  function handleDelete(id: string) {
    deleteSavedFilter(id);
    setSavedFilters(loadSavedFilters());
  }

  function handleApply(entry: SavedFilter) {
    props.onApplySaved(entry);
    props.onClose();
  }

  return (
    <div className="px-5 py-4 space-y-4">

      {/* Salvar filtro atual */}
      <section>
        <SectionLabel>{t("transactions.filterBar.salvarFiltro")}</SectionLabel>
        {showInput ? (
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder={t("transactions.filterBar.nomeFiltro")}
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setShowInput(false);
              }}
              className="flex-1"
            />
            <Button size="sm" onClick={handleSave} disabled={!savingName.trim()}>
              <BookmarkCheck className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowInput(false)}>
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setShowInput(true)}
          >
            {t("transactions.filterBar.salvarFiltroAtual")}
          </Button>
        )}
      </section>

      <Divider />

      {/* Lista de filtros salvos */}
      <section>
        <SectionLabel>{t("transactions.filterBar.filtrosSalvos")}</SectionLabel>
        {savedFilters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("transactions.filterBar.nenhumFiltroSalvo")}</p>
        ) : (
          <ul className="space-y-2">
            {savedFilters.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
                <button
                  type="button"
                  className="flex-1 text-left text-sm font-medium hover:text-primary"
                  onClick={() => handleApply(entry)}
                >
                  {entry.name}
                </button>
                <button
                  type="button"
                  aria-label={t("common.excluir")}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(entry.id)}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function FilterDrawer(props: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"new" | "saved">("new");

  return (
    <div className="flex h-full flex-col">

      {/* Cabecalho com abas */}
      <div className="shrink-0 border-b px-5 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <SheetTitle className="text-base font-semibold">
            {t("transactions.filterBar.filtroDeTransacoes")}
          </SheetTitle>
          <Button size="icon" variant="ghost" className="size-8" onClick={props.onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <TabList aria-label={t("transactions.filterBar.filtros")}>
          <Tab active={activeTab === "new"} onSelect={() => setActiveTab("new")}>
            {t("transactions.filterBar.novoFiltro")}
          </Tab>
          <Tab active={activeTab === "saved"} onSelect={() => setActiveTab("saved")}>
            {t("transactions.filterBar.filtrosSalvos")}
          </Tab>
        </TabList>
      </div>

      {/* Corpo com scroll */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "new" ? (
          <NewFilterTab {...props} />
        ) : (
          <SavedFiltersTab {...props} />
        )}
      </div>

      {/* Rodape fixo */}
      <div className="shrink-0 flex gap-2 border-t px-5 py-4">
        <Button
          variant="outline"
          className="flex-1"
          onClick={props.onClear}
        >
          {t("common.limparFiltros")}
        </Button>
        <Button className="flex-1" onClick={props.onClose}>
          {t("transactions.filterBar.aplicarFiltros")}
        </Button>
      </div>
    </div>
  );
}

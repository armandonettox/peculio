import { BookmarkCheck, ChevronDown, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Account } from "@/api/accounts";
import type { Category, Tag } from "@/api/labels";
import type { TransactionFilters } from "@/api/transactions";
import { DatePicker } from "@/components/date-picker";
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

const KIND_OPTIONS: { value: KindFilter | null; labelKey: string }[] = [
  { value: null, labelKey: "pages.transactions.todas" },
  { value: "deposit", labelKey: "pages.transactions.receitas" },
  { value: "withdrawal", labelKey: "pages.transactions.despesas" },
  { value: "transfer", labelKey: "pages.transactions.transferencias" },
  { value: "credit_card_expense", labelKey: "pages.transactions.despesasCartao" },
];

// Select visual com fundo e chevron, sem o <select> nativo aparecendo feio
type VisualSelectProps = {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
};

function VisualSelect({ value, onChange, options, placeholder }: VisualSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover py-1 shadow-md">
            {options.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`flex w-full px-3 py-2 text-left text-sm hover:bg-accent ${opt.value === value ? "font-semibold text-primary" : ""}`}
                >
                  {opt.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function Divider() {
  return <div className="border-t border-border" />;
}

// Aba "Novo filtro"
function NewFilterTab(props: Props) {
  const { t } = useTranslation();
  const { filters, kind, minDraft, maxDraft, accounts, categories, tags } = props;

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
            <label className="mb-1 block text-xs text-muted-foreground">{t("common.dataInicial")}</label>
            <DatePicker
              value={filters.dateFrom ?? ""}
              onChange={(v) => props.onChange({ dateFrom: v })}
              placeholder={t("common.dataInicial")}
              className={props.dateError ? "[&>button]:border-destructive" : ""}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("common.dataFinal")}</label>
            <DatePicker
              value={filters.dateTo ?? ""}
              onChange={(v) => props.onChange({ dateTo: v })}
              placeholder={t("common.dataFinal")}
            />
          </div>
        </div>
        {props.dateError && <p className="mt-1 text-xs text-destructive">{props.dateError}</p>}
      </section>

      <Divider />

      {/* Tipo */}
      <section>
        <SectionLabel>{t("transactions.filterBar.tipo")}</SectionLabel>
        <VisualSelect
          value={kind ?? ""}
          onChange={(v) => props.onKindChange((v as KindFilter) || null)}
          options={KIND_OPTIONS.map((opt) => ({ value: opt.value ?? "", label: t(opt.labelKey as never) }))}
          placeholder={t("pages.transactions.todas")}
        />
      </section>

      <Divider />

      {/* Conta */}
      <section>
        <SectionLabel>{t("common.conta")}</SectionLabel>
        <VisualSelect
          value={filters.accountId ?? ""}
          onChange={(v) => props.onChange({ accountId: v })}
          options={accountOptions}
          placeholder={t("common.todas")}
        />
      </section>

      {/* Categoria */}
      <section>
        <SectionLabel>{t("common.categoria")}</SectionLabel>
        <VisualSelect
          value={filters.categoryId ?? ""}
          onChange={(v) => props.onChange({ categoryId: v })}
          options={categoryOptions}
          placeholder={t("common.todas")}
        />
      </section>

      {/* Tag */}
      <section>
        <SectionLabel>{t("common.tag")}</SectionLabel>
        <VisualSelect
          value={filters.tagId ?? ""}
          onChange={(v) => props.onChange({ tagId: v })}
          options={tagOptions}
          placeholder={t("common.todas")}
        />
      </section>

      <Divider />

      {/* Valor */}
      <section>
        <SectionLabel>{t("transactions.filterBar.valor")}</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("transactions.filterBar.valorMinimo")}</label>
            <MoneyInput placeholder="0,00" places={2} value={minDraft} onChange={props.onMinChange} />
            {props.minError && <p className="mt-1 text-xs text-destructive">{props.minError}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("transactions.filterBar.valorMaximo")}</label>
            <MoneyInput placeholder="0,00" places={2} value={maxDraft} onChange={props.onMaxChange} />
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
          onClick={() => { props.onClear(); props.onClose(); }}
        >
          {t("transactions.filterBar.cancelar")}
        </Button>
        <Button className="flex-1" onClick={props.onClose}>
          {t("transactions.filterBar.aplicarFiltros")}
        </Button>
      </div>
    </div>
  );
}

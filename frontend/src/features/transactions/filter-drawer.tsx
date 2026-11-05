import { Bookmark, BookmarkCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Account } from "@/api/accounts";
import type { Category, Tag } from "@/api/labels";
import type { TransactionFilters } from "@/api/transactions";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SheetTitle } from "@/components/ui/sheet";

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

type QuickPeriod = {
  labelKey: string;
  range: () => { dateFrom: string; dateTo: string };
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastOfMonthStr(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

const QUICK_PERIODS: QuickPeriod[] = [
  {
    labelKey: "transactions.filterBar.esteMes",
    range: () => {
      const now = new Date();
      return { dateFrom: firstOfMonthStr(now), dateTo: lastOfMonthStr(now) };
    },
  },
  {
    labelKey: "transactions.filterBar.mesPassado",
    range: () => {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { dateFrom: firstOfMonthStr(prev), dateTo: lastOfMonthStr(prev) };
    },
  },
  {
    labelKey: "transactions.filterBar.ultimos3Meses",
    range: () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return { dateFrom: firstOfMonthStr(start), dateTo: lastOfMonthStr(now) };
    },
  },
  {
    labelKey: "transactions.filterBar.esteAno",
    range: () => {
      const now = new Date();
      return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: `${now.getFullYear()}-12-31` };
    },
  },
];

const KIND_OPTIONS: { value: KindFilter | null; labelKey: string }[] = [
  { value: null, labelKey: "pages.transactions.todas" },
  { value: "deposit", labelKey: "pages.transactions.receitas" },
  { value: "withdrawal", labelKey: "pages.transactions.despesas" },
  { value: "transfer", labelKey: "pages.transactions.transferencias" },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

export function FilterDrawer(props: Props) {
  const { t } = useTranslation();
  const { filters, kind, minDraft, maxDraft, accounts, categories, tags } = props;

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(loadSavedFilters);
  const [savingName, setSavingName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  function handleSave() {
    const name = savingName.trim();
    if (!name) return;
    saveFilter(name, filters, kind);
    setSavedFilters(loadSavedFilters());
    setSavingName("");
    setShowSaveInput(false);
  }

  function handleDeleteSaved(id: string) {
    deleteSavedFilter(id);
    setSavedFilters(loadSavedFilters());
  }

  function handleApplySaved(entry: SavedFilter) {
    props.onApplySaved(entry);
    props.onClose();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Cabecalho */}
      <div className="flex items-center justify-between border-b px-5 py-4">
        <SheetTitle className="text-base font-semibold">{t("transactions.filterBar.filtros")}</SheetTitle>
        <Button size="icon" variant="ghost" className="size-8" onClick={props.onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Corpo com scroll */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Filtros salvos */}
        {savedFilters.length > 0 && (
          <section>
            <SectionTitle>{t("transactions.filterBar.filtrosSalvos")}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {savedFilters.map((entry) => (
                <div key={entry.id} className="flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-xs">
                  <button
                    type="button"
                    className="font-medium hover:text-primary"
                    onClick={() => handleApplySaved(entry)}
                  >
                    {entry.name}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t("common.excluir")}
                    onClick={() => handleDeleteSaved(entry.id)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Periodo rapido */}
        <section>
          <SectionTitle>{t("transactions.filterBar.periodo")}</SectionTitle>
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_PERIODS.map((qp) => {
              const { dateFrom, dateTo } = qp.range();
              const active = filters.dateFrom === dateFrom && filters.dateTo === dateTo;
              return (
                <button
                  key={qp.labelKey}
                  type="button"
                  onClick={() => props.onChange({ dateFrom, dateTo })}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary hover:text-primary"
                  }`}
                >
                  {t(qp.labelKey as never)}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t("common.dataInicial")}</label>
              <Input
                type="date"
                value={filters.dateFrom ?? ""}
                onChange={(e) => props.onChange({ dateFrom: e.target.value })}
                className={props.dateError ? "border-destructive" : ""}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t("common.dataFinal")}</label>
              <Input
                type="date"
                value={filters.dateTo ?? ""}
                onChange={(e) => props.onChange({ dateTo: e.target.value })}
              />
            </div>
          </div>
          {props.dateError && <p className="mt-1 text-xs text-destructive">{props.dateError}</p>}
        </section>

        {/* Tipo */}
        <section>
          <SectionTitle>{t("transactions.filterBar.tipo")}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value ?? "todas"}
                type="button"
                onClick={() => props.onKindChange(opt.value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  kind === opt.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:border-primary hover:text-primary"
                }`}
              >
                {t(opt.labelKey as never)}
              </button>
            ))}
          </div>
        </section>

        {/* Conta */}
        <section>
          <SectionTitle>{t("common.conta")}</SectionTitle>
          <Select
            value={filters.accountId ?? ""}
            onChange={(e) => props.onChange({ accountId: e.target.value })}
          >
            <option value="">{t("common.todas")}</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
                {acc.active ? "" : ` ${t("transactions.filterBar.arquivada")}`}
              </option>
            ))}
          </Select>
        </section>

        {/* Categoria */}
        <section>
          <SectionTitle>{t("common.categoria")}</SectionTitle>
          <Select
            value={filters.categoryId ?? ""}
            onChange={(e) => props.onChange({ categoryId: e.target.value })}
          >
            <option value="">{t("common.todas")}</option>
            <option value="none">{t("transactions.filterBar.semCategoria")}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </Select>
        </section>

        {/* Tag */}
        <section>
          <SectionTitle>{t("common.tag")}</SectionTitle>
          <Select
            value={filters.tagId ?? ""}
            onChange={(e) => props.onChange({ tagId: e.target.value })}
          >
            <option value="">{t("common.todas")}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </Select>
        </section>

        {/* Valor */}
        <section>
          <SectionTitle>{t("transactions.filterBar.valor")}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t("transactions.filterBar.valorMinimo")}</label>
              <MoneyInput
                placeholder="0,00"
                places={2}
                value={minDraft}
                onChange={props.onMinChange}
              />
              {props.minError && <p className="mt-1 text-xs text-destructive">{props.minError}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t("transactions.filterBar.valorMaximo")}</label>
              <MoneyInput
                placeholder="0,00"
                places={2}
                value={maxDraft}
                onChange={props.onMaxChange}
              />
              {props.maxError && <p className="mt-1 text-xs text-destructive">{props.maxError}</p>}
            </div>
          </div>
        </section>

        {/* Salvar filtro */}
        <section>
          <SectionTitle>{t("transactions.filterBar.salvarFiltro")}</SectionTitle>
          {showSaveInput ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                placeholder={t("transactions.filterBar.nomeFiltro")}
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowSaveInput(false); }}
                className="flex-1"
              />
              <Button size="sm" onClick={handleSave} disabled={!savingName.trim()}>
                <BookmarkCheck className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowSaveInput(false)}>
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="gap-2 w-full" onClick={() => setShowSaveInput(true)}>
              <Bookmark className="size-4" />
              {t("transactions.filterBar.salvarFiltroAtual")}
            </Button>
          )}
        </section>
      </div>

      {/* Rodape fixo */}
      <div className="flex gap-2 border-t px-5 py-4">
        <Button variant="outline" className="flex-1 gap-2" onClick={props.onClear}>
          <Trash2 className="size-4" />
          {t("common.limparFiltros")}
        </Button>
        <Button className="flex-1" onClick={props.onClose}>
          {t("transactions.filterBar.verResultados")}
        </Button>
      </div>
    </div>
  );
}

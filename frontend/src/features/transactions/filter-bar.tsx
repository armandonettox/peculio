import { Search, SlidersHorizontal, X } from "lucide-react";
import { useId, useState } from "react";

import type { Account } from "@/api/accounts";
import type { Category, Tag } from "@/api/labels";
import type { TransactionFilters } from "@/api/transactions";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type FilterBarProps = {
  filters: TransactionFilters;
  activeCount: number;
  // Campos digitados: o rascunho aparece na hora e o filtro so muda depois de uma pausa
  searchDraft: string;
  minDraft: string;
  maxDraft: string;
  onSearchChange: (value: string) => void;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  minError?: string;
  maxError?: string;
  dateError?: string;
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  // Campos que mudam o filtro na hora (selecao e datas)
  onChange: (patch: Partial<TransactionFilters>) => void;
  onClear: () => void;
};

export function FilterBar(props: FilterBarProps) {
  const { filters, activeCount, searchDraft, minDraft, maxDraft, accounts, categories, tags } = props;
  const panelId = useId();
  // Abre sozinho quando a pagina chega com filtros do painel aplicados (link ou botao Voltar)
  const panelCount = activeCount - (filters.q ? 1 : 0);
  const [open, setOpen] = useState(panelCount > 0);

  return (
    <section aria-label="Filtros" className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Buscar lançamentos"
            placeholder="Buscar lançamentos"
            value={searchDraft}
            onChange={(event) => props.onSearchChange(event.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <SlidersHorizontal />
          Filtros{panelCount > 0 ? ` (${panelCount})` : ""}
        </Button>
        {activeCount > 0 && (
          <Button type="button" variant="ghost" onClick={props.onClear}>
            <X />
            Limpar filtros
          </Button>
        )}
      </div>

      <div
        id={panelId}
        hidden={!open}
        className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <FormField id="filter-account" label="Conta">
          {(field) => (
            <Select
              {...field}
              value={filters.accountId ?? ""}
              onChange={(event) => props.onChange({ accountId: event.target.value })}
            >
              <option value="">Todas</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.active ? "" : " (arquivada)"}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField id="filter-category" label="Categoria">
          {(field) => (
            <Select
              {...field}
              value={filters.categoryId ?? ""}
              onChange={(event) => props.onChange({ categoryId: event.target.value })}
            >
              <option value="">Todas</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField id="filter-tag" label="Tag">
          {(field) => (
            <Select
              {...field}
              value={filters.tagId ?? ""}
              onChange={(event) => props.onChange({ tagId: event.target.value })}
            >
              <option value="">Todas</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField id="filter-date-from" label="Data inicial" error={props.dateError}>
          {(field) => (
            <Input
              {...field}
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(event) => props.onChange({ dateFrom: event.target.value })}
            />
          )}
        </FormField>

        <FormField id="filter-date-to" label="Data final">
          {(field) => (
            <Input
              {...field}
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(event) => props.onChange({ dateTo: event.target.value })}
            />
          )}
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField id="filter-min" label="Valor mínimo" error={props.minError}>
            {(field) => (
              <Input
                {...field}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={minDraft}
                onChange={(event) => props.onMinChange(event.target.value)}
              />
            )}
          </FormField>
          <FormField id="filter-max" label="Valor máximo" error={props.maxError}>
            {(field) => (
              <Input
                {...field}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={maxDraft}
                onChange={(event) => props.onMaxChange(event.target.value)}
              />
            )}
          </FormField>
        </div>
      </div>
    </section>
  );
}

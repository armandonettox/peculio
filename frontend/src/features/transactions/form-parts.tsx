import { CalendarDays } from "lucide-react";
import { useState, type ElementType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Tag } from "@/api/labels";
import { Input } from "@/components/ui/input";
import { appToday, shiftDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

// Pecas que os formularios de despesa, receita e transferencia usam do mesmo jeito.

// Campos sem borda de caixa, so uma linha embaixo
export const UNDERLINED =
  "rounded-none border-0 border-b bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:border-primary";

// Uma linha do formulario: icone na frente e o campo ao lado
export function Row({ icon: Icon, children }: { icon: ElementType; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// Escolha de tags: botoes que ligam e desligam, com aria-pressed
export function TagPicker({
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

type DateChipsProps = {
  // AAAA-MM-DD
  value: string;
  onChange: (date: string) => void;
  // Cor do atalho ligado (a mesma do valor: vermelho na despesa, verde na receita, azul na transferencia)
  activeClassName: string;
  error?: string;
};

/**
 * Hoje, Ontem e Outros: dois atalhos e um campo de data que aparece em Outros (ou quando a data nao e nenhuma das duas).
 * Para voltar ao estado inicial, quem usa troca a `key` e o componente recomeca.
 */
export function DateChips({ value, onChange, activeClassName, error }: DateChipsProps) {
  const { t } = useTranslation();
  const [other, setOther] = useState(false);
  const today = appToday();
  const yesterday = shiftDay(today, -1);
  const custom = other || (value !== today && value !== yesterday);
  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active ? activeClassName : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
    );

  return (
    <Row icon={CalendarDays}>
      <div role="group" aria-label={t("common.data")} className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={value === today && !other}
          className={chip(value === today && !other)}
          onClick={() => {
            setOther(false);
            onChange(today);
          }}
        >
          {t("transactions.expenseForm.today")}
        </button>
        <button
          type="button"
          aria-pressed={value === yesterday && !other}
          className={chip(value === yesterday && !other)}
          onClick={() => {
            setOther(false);
            onChange(yesterday);
          }}
        >
          {t("transactions.expenseForm.yesterday")}
        </button>
        <button type="button" aria-pressed={custom} className={chip(custom)} onClick={() => setOther(true)}>
          {t("transactions.expenseForm.otherDate")}
        </button>
      </div>
      {custom && (
        <div className="mt-2">
          <Input
            id="tx-date"
            type="date"
            aria-label={t("common.data")}
            aria-invalid={Boolean(error)}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={UNDERLINED}
          />
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </Row>
  );
}

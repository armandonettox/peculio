import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { currentIntlLocale } from "@/i18n";
import { formatMonthYear } from "@/lib/dates";
import { withYear, yearOf } from "@/lib/month";
import { cn } from "@/lib/utils";

type Props = {
  // Primeiro dia do mes escolhido ("2026-11-01")
  value: string;
  // Primeiro dia do mes de hoje: o botao "Mes atual" volta para ele
  currentMonth: string;
  onChange: (month: string) => void;
  // "plain": so o texto do mes e a seta, sem borda (o topo da tela inicial do celular)
  variant?: "pill" | "plain";
};

function shortMonthName(year: number, index: number): string {
  const text = new Intl.DateTimeFormat(currentIntlLocale(), { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, index, 1)));
  return text.replace(/\.$/, "");
}

/**
 * Seletor de mes do painel: um botao com o mes escolhido que abre uma grade de 12 meses, com setas para
 * trocar o ano, "Cancelar" e "Mes atual". Esc e clique fora fecham sem mudar nada.
 */
export function MonthPicker({ value, currentMonth, onChange, variant = "pill" }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => yearOf(value));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    // Ao abrir, a grade mostra o ano do mes escolhido, nao o ano em que a pessoa parou da vez anterior
    if (!open) setYear(yearOf(value));
    setOpen(!open);
  }

  function pick(month: string) {
    onChange(month);
    setOpen(false);
    triggerRef.current?.focus();
  }

  const selectedYear = yearOf(value);
  const selectedIndex = Number(value.slice(5, 7)) - 1;

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("dashboard.monthPicker.chooseMonth", { month: formatMonthYear(value) })}
        className={cn(
          "inline-flex items-center gap-2 font-medium",
          variant === "pill" ? "rounded-full border bg-card px-4 py-1.5 text-sm hover:bg-muted" : "rounded-md px-2 py-1 text-lg hover:bg-muted",
        )}
      >
        {variant === "pill" && <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />}
        {formatMonthYear(value)}
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("dashboard.monthPicker.monthSelection")}
          className="absolute left-1/2 top-full z-30 -translate-x-1/2 mt-2 w-72 rounded-xl border bg-card p-3 shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between rounded-lg bg-primary px-2 py-1.5 text-primary-foreground">
            <button
              type="button"
              onClick={() => setYear(year - 1)}
              aria-label={t("dashboard.monthPicker.previousYear")}
              className="rounded p-1 hover:bg-white/15"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold tabular-nums" aria-live="polite">
              {year}
            </span>
            <button
              type="button"
              onClick={() => setYear(year + 1)}
              aria-label={t("dashboard.monthPicker.nextYear")}
              className="rounded p-1 hover:bg-white/15"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {Array.from({ length: 12 }, (_, index) => {
              const month = withYear(`2000-${String(index + 1).padStart(2, "0")}-01`, year);
              const selected = year === selectedYear && index === selectedIndex;
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => pick(month)}
                  aria-pressed={selected}
                  className={cn(
                    "rounded-md px-1 py-2 text-xs font-medium uppercase hover:bg-muted",
                    selected && "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {shortMonthName(year, index)}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("common.cancelar")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => pick(currentMonth)}>
              {t("dashboard.monthPicker.currentMonth")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

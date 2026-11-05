import { CalendarDays, X } from "lucide-react";
import { useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

import { cn } from "@/lib/utils";

const PT_BR_MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const PT_BR_WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function isoToDate(iso: string): Date | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? undefined : date;
}

function dateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplay(iso: string): string {
  const d = isoToDate(iso);
  if (!d) return "";
  return `${d.getDate()} ${PT_BR_MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

type Props = {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  className?: string;
};

export function DatePicker({ value, onChange, placeholder = "Selecionar data", className }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = isoToDate(value);

  function handleSelect(date: Date | undefined) {
    if (date) {
      onChange(dateToIso(date));
      setOpen(false);
    }
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("flex-1 text-left", selected ? "text-foreground" : "text-muted-foreground")}>
          {selected ? formatDisplay(value) : placeholder}
        </span>
        {selected && (
          <X
            className="size-3.5 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleClear}
          />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 rounded-md border bg-popover shadow-md">
            <DayPicker
              mode="single"
              selected={selected}
              onSelect={handleSelect}
              defaultMonth={selected ?? new Date()}
              formatters={{
                formatMonthCaption: (date) => `${PT_BR_MONTHS[date.getMonth()]} ${date.getFullYear()}`,
                formatWeekdayName: (date) => PT_BR_WEEKDAYS_SHORT[date.getDay()],
              }}
              classNames={{
                root: "p-3",
                months: "flex flex-col",
                month: "space-y-2",
                caption: "flex justify-center relative items-center mb-1",
                caption_label: "text-sm font-semibold",
                nav: "flex items-center gap-1",
                nav_button: "size-7 rounded-full border border-input bg-background hover:bg-accent flex items-center justify-center text-muted-foreground",
                nav_button_previous: "absolute left-0",
                nav_button_next: "absolute right-0",
                table: "w-full border-collapse",
                head_row: "flex",
                head_cell: "text-muted-foreground w-8 text-center text-xs font-medium",
                row: "flex w-full mt-1",
                cell: "size-8 text-center",
                day: "size-8 rounded-full text-sm hover:bg-accent flex items-center justify-center w-full cursor-pointer",
                day_selected: "bg-primary text-primary-foreground hover:bg-primary",
                day_today: "font-bold text-primary",
                day_outside: "text-muted-foreground opacity-50",
                day_disabled: "text-muted-foreground opacity-30 cursor-not-allowed",
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

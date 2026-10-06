import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, Clock, MoreVertical, Pencil, Trash2 } from "lucide-react";

import type { BillStatus } from "@/api/bills";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { amountRangeText, FREQUENCY_LABELS, matchText, nextDueText, statusText } from "./presentation";

type Props = {
  bill: BillStatus;
  today: string;
  onEdit: (bill: BillStatus) => void;
  onToggleArchive: (bill: BillStatus) => void;
  onDelete: (bill: BillStatus) => void;
};

const STATUS_STYLE = {
  paid: { icon: CheckCircle2, className: "text-positive" },
  overdue: { icon: AlertTriangle, className: "text-destructive" },
  upcoming: { icon: Clock, className: "text-muted-foreground" },
} as const;

export function BillCard({ bill, today, onEdit, onToggleArchive, onDelete }: Props) {
  const { icon: StatusIcon, className } = STATUS_STYLE[bill.status];

  return (
    <li className={cn("rounded-lg border bg-card p-4 text-card-foreground shadow-sm", !bill.active && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate text-base font-semibold">{bill.name}</h3>
            {!bill.active && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Arquivada</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {FREQUENCY_LABELS[bill.frequency]} · {amountRangeText(bill)}
            {bill.currency_code !== "BRL" ? ` · ${bill.currency_code}` : ""}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Ações da conta a pagar ${bill.name}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={() => onEdit(bill)}>
              <Pencil />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleArchive(bill)}>
              {bill.active ? <Archive /> : <ArchiveRestore />}
              {bill.active ? "Arquivar" : "Restaurar"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(bill)} className="text-destructive">
              <Trash2 />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className={cn("flex items-center gap-1.5 text-sm font-medium", className)}>
          <StatusIcon className="size-4 shrink-0" aria-hidden="true" />
          {statusText(bill)}
        </p>
        <p className="text-sm text-muted-foreground">
          {nextDueText(bill, today)}
          {bill.next_due_paid && <span className="font-medium text-positive"> · já pago</span>}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{matchText(bill)}</p>
    </li>
  );
}

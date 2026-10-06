import { AlertTriangle, Archive, ArchiveRestore, History, MinusCircle, MoreVertical, Pencil, PlusCircle, Trash2 } from "lucide-react";

import type { PiggyBank } from "@/api/piggy-banks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { availableText, isReached, remainingText, targetText } from "./presentation";

export type PiggyAction = "add" | "remove" | "history" | "edit" | "archive" | "delete";

type Props = {
  piggy: PiggyBank;
  today: string;
  onAction: (action: PiggyAction, piggy: PiggyBank) => void;
};

export function PiggyBankCard({ piggy, today, onAction }: Props) {
  const reached = isReached(piggy);
  // A barra enche ate 100%; o que passou da meta aparece no percentual
  const filled = Math.min(piggy.percent, 100);
  const target = targetText(piggy, today);
  const available = availableText(piggy);
  const archived = !piggy.active;

  return (
    <li className={cn("rounded-lg border bg-card p-4 text-card-foreground shadow-sm", archived && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate text-base font-semibold">{piggy.name}</h3>
            {archived && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Arquivado</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {piggy.account_name}
            {piggy.currency_code !== "BRL" ? ` · ${piggy.currency_code}` : ""}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Ações do cofrinho ${piggy.name}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {!archived && (
              <DropdownMenuItem onSelect={() => onAction("add", piggy)}>
                <PlusCircle />
                Guardar
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onAction("remove", piggy)}>
              <MinusCircle />
              Retirar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("history", piggy)}>
              <History />
              Histórico
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction("edit", piggy)}>
              <Pencil />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("archive", piggy)}>
              {archived ? <ArchiveRestore /> : <Archive />}
              {archived ? "Desarquivar" : "Arquivar"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("delete", piggy)} className="text-destructive">
              <Trash2 />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        role="progressbar"
        aria-label={`Progresso de ${piggy.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={filled}
        aria-valuetext={`${piggy.percent}% da meta`}
        className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", reached ? "bg-positive" : "bg-primary-text")}
          style={{ width: `${filled}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{formatMoney(piggy.saved, piggy.currency_code)}</span>
          <span className="text-muted-foreground"> de {formatMoney(piggy.target_amount, piggy.currency_code)}</span>
        </p>
        <p className={cn("text-sm", reached ? "font-medium text-positive" : "text-muted-foreground")}>
          {remainingText(piggy)}
        </p>
      </div>

      {target && <p className="mt-1 text-sm text-muted-foreground">{target}</p>}

      {archived && (
        <p className="mt-1 text-xs text-muted-foreground">
          Arquivado: o valor guardado continua reservado na conta. Retire para liberar.
        </p>
      )}

      <p
        className={cn("mt-1 flex items-start gap-1.5 text-xs", available.warning ? "text-destructive" : "text-muted-foreground")}
        role={available.warning ? "alert" : undefined}
      >
        {available.warning && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />}
        <span>{available.text}</span>
      </p>
    </li>
  );
}

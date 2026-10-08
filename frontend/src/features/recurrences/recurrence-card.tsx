import { AlertTriangle, MoreVertical, Pause, Pencil, Play, Trash2 } from "lucide-react";

import type { Recurrence } from "@/api/recurrences";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createdText, endText, frequencyLabel, nextText, templateSummary } from "./presentation";
import { useTranslation } from "react-i18next";

type Props = {
  recurrence: Recurrence;
  today: string;
  onEdit: (recurrence: Recurrence) => void;
  onToggleActive: (recurrence: Recurrence) => void;
  onDelete: (recurrence: Recurrence) => void;
};

export function RecurrenceCard({ recurrence, today, onEdit, onToggleActive, onDelete }: Props) {
  const { t } = useTranslation();
  const paused = !recurrence.active;
  // Terminada nao pode ser pausada nem retomada: nao ha mais o que criar
  const canToggle = !recurrence.ended;

  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate text-base font-semibold">{recurrence.name}</h3>
            {paused && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t("recurrences.recurrenceCard.pausada")}</span>}
            {recurrence.ended && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t("recurrences.recurrenceCard.terminou")}</span>
            )}
          </div>
          <p className="break-words text-sm text-muted-foreground">
            {frequencyLabel(recurrence.frequency)} · {templateSummary(recurrence.template)}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("recurrences.recurrenceCard.acoesDaRecorrente", { name: recurrence.name })}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onSelect={() => onEdit(recurrence)}>
              <Pencil />
              {t("common.editar")}
            </DropdownMenuItem>
            {canToggle && (
              <DropdownMenuItem onSelect={() => onToggleActive(recurrence)}>
                {recurrence.active ? <Pause /> : <Play />}
                {recurrence.active ? t("recurrences.recurrenceCard.pausar") : t("recurrences.recurrenceCard.retomar")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(recurrence)} className="text-destructive">
              <Trash2 />
              {t("common.excluir")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <p>{nextText(recurrence, today)}</p>
        <p>
          {endText(recurrence)}
          {recurrence.created_count > 0 && !recurrence.max_occurrences ? ` · ${createdText(recurrence.created_count)}` : ""}
        </p>
      </div>

      {paused && !recurrence.ended && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("recurrences.recurrenceCard.aoRetomarOPeriodo")}
        </p>
      )}

      {recurrence.last_error && (
        <p className="mt-3 flex items-start gap-1.5 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t("recurrences.recurrenceCard.naoFoiPossivelCriar", { error: recurrence.last_error })}</span>
        </p>
      )}
    </li>
  );
}

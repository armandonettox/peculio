import { MoreVertical, Pause, Pencil, Play, Trash2 } from "lucide-react";

import type { Rule } from "@/api/rules";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { actionSummary, triggerSummary, type NameLookups } from "./presentation";
import { useTranslation } from "react-i18next";

type Props = {
  rule: Rule;
  lookups: NameLookups;
  onEdit: (rule: Rule) => void;
  onToggleActive: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
};

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">{children}</span>
  );
}

export function RuleCard({ rule, lookups, onEdit, onToggleActive, onDelete }: Props) {
  const { t } = useTranslation();
  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words font-medium">{rule.name}</h3>
            {!rule.active && <Badge>{t("rules.ruleCard.pausada")}</Badge>}
            {rule.stop_processing && <Badge>{t("rules.ruleCard.paraAqui")}</Badge>}
          </div>

          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {rule.match_mode === "all" ? t("rules.ruleCard.quandoTodosValerem") : t("rules.ruleCard.quandoQualquerUmValer")}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {rule.triggers.map((trigger, index) => (
              <li key={index}>{triggerSummary(trigger, lookups)}</li>
            ))}
          </ul>

          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("rules.ruleCard.entao")}</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm">
            {rule.actions.map((action, index) => (
              <li key={index}>{actionSummary(action, lookups)}</li>
            ))}
          </ul>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("rules.ruleCard.acoesDaRegra", { name: rule.name })}
              className="-mr-2 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onSelect={() => onEdit(rule)}>
              <Pencil />
              {t("common.editar")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleActive(rule)}>
              {rule.active ? <Pause /> : <Play />}
              {rule.active ? t("rules.ruleCard.pausar") : t("rules.ruleCard.ativar")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(rule)} className="text-destructive">
              <Trash2 />
              {t("common.excluir")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

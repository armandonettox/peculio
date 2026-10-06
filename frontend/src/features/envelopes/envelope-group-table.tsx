import { AlertTriangle, MoreVertical, Pencil, Target, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useCurrencies } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { useSetAllocation, type Envelope, type EnvelopeGroup } from "@/api/envelopes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatMoney, placesOf } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  availableLabel,
  availableState,
  parseAllocation,
  toBudgetHint,
  toBudgetState,
  toInputText,
} from "./presentation";
import { goalLabel, templateSummary } from "./template-presentation";
import { useTranslation } from "react-i18next";

export type EnvelopeAction = "edit" | "template" | "delete";

type Props = {
  month: string;
  group: EnvelopeGroup;
  onAction: (action: EnvelopeAction, envelope: Envelope) => void;
  onError: (message: string | null) => void;
  // Abre o "Mover" ja levando dinheiro para o envelope que estourou
  onCover: (envelope: Envelope) => void;
  // Nome de cada conta a pagar (id -> nome), para o resumo do template "conta a pagar"
  billNames?: Record<string, string>;
};

/** Um grupo (uma moeda): o "A orcar" no topo e a tabela dos envelopes do mes. */
export function EnvelopeGroupTable({ month, group, onAction, onError, onCover, billNames = {} }: Props) {
  const { t } = useTranslation();
  const state = toBudgetState(group);
  const code = group.currency_code;

  return (
    <section aria-label={t("envelopes.envelopeGroupTable.envelopesEm", { code })} className="flex flex-col gap-3">
      <div
        className={cn(
          "rounded-lg border p-4",
          state === "negative" ? "border-destructive bg-destructive/5" : "bg-card",
        )}
      >
        <p className="text-sm text-muted-foreground">{t("envelopes.envelopeGroupTable.aOrcar", { code })}</p>
        <p
          className={cn("text-2xl font-semibold tabular-nums", state === "negative" && "text-destructive")}
          aria-label={t("envelopes.envelopeGroupTable.aOrcarEm", { code })}
        >
          {formatMoney(group.to_budget, code)}
        </p>
        <p className={cn("mt-1 text-xs", state === "negative" ? "text-destructive" : "text-muted-foreground")}>
          {toBudgetHint(state)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("envelopes.envelopeGroupTable.dinheiroNasContas", {
            money: formatMoney(group.money, code),
            inEnvelopes: formatMoney(group.in_envelopes, code),
          })}
        </p>
      </div>

      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t("envelopes.envelopeGroupTable.envelopesEm", { code })}</caption>
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-2 sm:px-3 font-medium">
                {t("envelopes.envelopeGroupTable.envelope")}
              </th>
              <th scope="col" className="hidden px-2 py-2 sm:px-3 text-right font-medium sm:table-cell">
                {t("envelopes.envelopeGroupTable.passouDoMesAnterior")}
              </th>
              <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">
                {t("envelopes.envelopeGroupTable.distribuido")}
              </th>
              <th scope="col" className="hidden px-2 py-2 sm:px-3 text-right font-medium sm:table-cell">
                {t("envelopes.envelopeGroupTable.gasto")}
              </th>
              <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">
                {t("envelopes.envelopeGroupTable.disponivel")}
              </th>
              <th scope="col" className="w-10 px-2 py-2">
                <span className="sr-only">{t("envelopes.envelopeGroupTable.acoes")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {group.envelopes.map((envelope) => (
              <EnvelopeRow
                key={envelope.budget_id}
                month={month}
                code={code}
                envelope={envelope}
                onAction={onAction}
                onError={onError}
                onCover={onCover}
                billNames={billNames}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EnvelopeRow({
  month,
  code,
  envelope,
  onAction,
  onError,
  onCover,
  billNames,
}: {
  month: string;
  code: string;
  envelope: Envelope;
  onAction: Props["onAction"];
  onError: Props["onError"];
  onCover: Props["onCover"];
  billNames: Record<string, string>;
}) {
  const { t } = useTranslation();
  const currencies = useCurrencies();
  const set = useSetAllocation(month);
  const places = placesOf(code, Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places])));
  const shown = toInputText(envelope.allocated);
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState<string | null>(null);

  // Quando o servidor devolve outro valor (mover, outro mes), o campo acompanha
  useEffect(() => {
    setText(shown);
    setInvalid(null);
  }, [shown]);

  const state = availableState(envelope);
  const label = availableLabel(state);

  async function commit() {
    onError(null);
    const parsed = parseAllocation(text, places);
    if (!parsed.ok) {
      setInvalid(parsed.error);
      return;
    }
    setInvalid(null);
    // Sem mudanca nao chama a API
    if (toInputText(parsed.value) === shown || (parsed.value === "0" && /^0([.,]0+)?$/.test(shown))) {
      setText(shown);
      return;
    }
    try {
      await set.mutateAsync({ budgetId: envelope.budget_id, amount: parsed.value });
    } catch (error) {
      onError(getErrorMessage(error));
      setText(shown);
    }
  }

  return (
    <tr>
      <th scope="row" className="px-2 py-2 sm:px-3 font-medium">
        {envelope.name}
        {envelope.template && (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            {templateSummary(envelope.template, code, envelope.template.bill_id ? billNames[envelope.template.bill_id] : undefined)}
          </span>
        )}
        {envelope.goal && (
          <span
            className={cn(
              "mt-1 inline-block rounded-md px-1.5 py-0.5 text-xs font-normal",
              envelope.goal === "met" ? "bg-positive/10 text-positive" : "bg-muted text-muted-foreground",
            )}
          >
            {goalLabel(envelope.goal)}
          </span>
        )}
      </th>
      <td className="hidden px-2 py-2 sm:px-3 text-right tabular-nums text-muted-foreground sm:table-cell">
        {formatMoney(envelope.carried, code)}
      </td>
      <td className="px-2 py-2 sm:px-3 text-right">
        <Input
          aria-label={t("envelopes.envelopeGroupTable.distribuidoPara", { name: envelope.name })}
          aria-invalid={invalid !== null}
          inputMode="decimal"
          autoComplete="off"
          className="ml-auto h-8 w-24 text-right tabular-nums sm:w-28"
          value={text}
          disabled={set.isPending}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
          }}
        />
        {invalid && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {invalid}
          </p>
        )}
      </td>
      <td className="hidden px-2 py-2 sm:px-3 text-right tabular-nums text-muted-foreground sm:table-cell">
        {formatMoney(envelope.spent, code)}
      </td>
      <td className="px-2 py-2 sm:px-3 text-right tabular-nums">
        <span className={cn("font-semibold", state === "overspent" && "text-destructive")}>
          {formatMoney(envelope.available, code)}
        </span>
        {label && (
          <span
            className={cn(
              "ml-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
              state === "overspent" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
            )}
          >
            {state === "overspent" && <AlertTriangle className="size-3" aria-hidden="true" />}
            {label}
          </span>
        )}
        {state === "overspent" && (
          <button
            type="button"
            className="mt-1 block w-full text-right text-xs text-primary-text underline-offset-4 hover:underline"
            onClick={() => onCover(envelope)}
          >
            {t("envelopes.envelopeGroupTable.cobrir", { amount: formatMoney(envelope.overspent, code) })}
          </button>
        )}
      </td>
      <td className="px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("envelopes.envelopeGroupTable.acoesDoEnvelope", { name: envelope.name })}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onSelect={() => onAction("edit", envelope)}>
              <Pencil />
              {t("common.editar")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("template", envelope)}>
              <Target />
              {envelope.template ? t("envelopes.envelopeGroupTable.mudarTemplate") : t("envelopes.envelopeGroupTable.definirTemplate")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction("delete", envelope)} className="text-destructive">
              <Trash2 />
              {t("common.excluir")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

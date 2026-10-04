import { AlertTriangle, MoreVertical, Pencil, Trash2 } from "lucide-react";
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

export type EnvelopeAction = "edit" | "delete";

type Props = {
  month: string;
  group: EnvelopeGroup;
  onAction: (action: EnvelopeAction, envelope: Envelope) => void;
  onError: (message: string | null) => void;
  // Abre o "Mover" ja levando dinheiro para o envelope que estourou
  onCover: (envelope: Envelope) => void;
};

/** Um grupo (uma moeda): o "A orcar" no topo e a tabela dos envelopes do mes. */
export function EnvelopeGroupTable({ month, group, onAction, onError, onCover }: Props) {
  const state = toBudgetState(group);
  const code = group.currency_code;

  return (
    <section aria-label={`Envelopes em ${code}`} className="flex flex-col gap-3">
      <div
        className={cn(
          "rounded-lg border p-4",
          state === "negative" ? "border-destructive bg-destructive/5" : "bg-card",
        )}
      >
        <p className="text-sm text-muted-foreground">A orçar ({code})</p>
        <p
          className={cn("text-2xl font-semibold tabular-nums", state === "negative" && "text-destructive")}
          aria-label={`A orçar em ${code}`}
        >
          {formatMoney(group.to_budget, code)}
        </p>
        <p className={cn("mt-1 text-xs", state === "negative" ? "text-destructive" : "text-muted-foreground")}>
          {toBudgetHint(state)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Dinheiro nas contas: {formatMoney(group.money, code)} · Nos envelopes: {formatMoney(group.in_envelopes, code)}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Envelopes em {code}</caption>
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-2 py-2 sm:px-3 font-medium">
                Envelope
              </th>
              <th scope="col" className="hidden px-2 py-2 sm:px-3 text-right font-medium sm:table-cell">
                Passou do mês anterior
              </th>
              <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">
                Distribuído
              </th>
              <th scope="col" className="hidden px-2 py-2 sm:px-3 text-right font-medium sm:table-cell">
                Gasto
              </th>
              <th scope="col" className="px-2 py-2 sm:px-3 text-right font-medium">
                Disponível
              </th>
              <th scope="col" className="w-10 px-2 py-2">
                <span className="sr-only">Ações</span>
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
}: {
  month: string;
  code: string;
  envelope: Envelope;
  onAction: Props["onAction"];
  onError: Props["onError"];
  onCover: Props["onCover"];
}) {
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
      </th>
      <td className="hidden px-2 py-2 sm:px-3 text-right tabular-nums text-muted-foreground sm:table-cell">
        {formatMoney(envelope.carried, code)}
      </td>
      <td className="px-2 py-2 sm:px-3 text-right">
        <Input
          aria-label={`Distribuído para ${envelope.name}`}
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
            Cobrir {formatMoney(envelope.overspent, code)}
          </button>
        )}
      </td>
      <td className="px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Ações do envelope ${envelope.name}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onSelect={() => onAction("edit", envelope)}>
              <Pencil />
              Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction("delete", envelope)} className="text-destructive">
              <Trash2 />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

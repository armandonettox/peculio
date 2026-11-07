import { useState } from "react";
import { useTranslation } from "react-i18next";

import { getErrorMessage } from "@/api/error-messages";
import { useUpdateMonthlyPlan, type CardCounting } from "@/api/plans";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const OPTIONS: CardCounting[] = ["purchase", "invoice"];

/** As duas formas de contar uma compra no cartao: pela data da compra ou pelo vencimento da fatura. */
export function CardCountingChoice({
  value,
  onChange,
  name = "card-counting",
}: {
  value: CardCounting;
  onChange: (next: CardCounting) => void;
  name?: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{t("planning.card.question")}</legend>
      {OPTIONS.map((option) => (
        <label
          key={option}
          className={cn(
            "flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            value === option && "border-primary bg-accent/40",
          )}
        >
          <span className="flex flex-col gap-1">
            <span className="font-medium">{t(`planning.card.${option}.title`)}</span>
            <span className="text-sm text-muted-foreground">{t(`planning.card.${option}.text`)}</span>
          </span>
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            className="mt-1 accent-[var(--primary)]"
          />
        </label>
      ))}
    </fieldset>
  );
}

/** Muda como as compras no cartao entram na conta do planejamento do mes. */
export function CardCountingDialog({ month, current, onClose }: { month: string; current: CardCounting; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateMonthlyPlan();
  const [value, setValue] = useState<CardCounting>(current);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      if (value !== current) await update.mutateAsync({ month, body: { card_counting: value } });
      onClose();
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !update.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("planning.actions.cardView")}</DialogTitle>
          <DialogDescription>{t("planning.card.hint")}</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive">{error}</Alert>}
        <CardCountingChoice value={value} onChange={setValue} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
            {t("common.cancelar")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={update.isPending}>
            {update.isPending ? t("planning.saving") : t("planning.newBudget.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

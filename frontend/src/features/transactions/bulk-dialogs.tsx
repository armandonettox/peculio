import { useState, type FormEvent } from "react";

import type { Category } from "@/api/labels";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { appToday } from "@/lib/dates";
import { entriesText } from "./bulk-presentation";
import { useTranslation } from "react-i18next";

// Valor do seletor para "tirar a categoria"; vazio e "ainda nao escolhi"
const NONE = "none";

type CategoryProps = {
  count: number;
  categories: Category[];
  // null = tirar a categoria. A acao em si (e o erro dela) e de quem chama; o dialogo fecha quando ela termina.
  onConfirm: (categoryId: string | null) => Promise<unknown>;
  onClose: () => void;
};

/** Escolhe a categoria nova (ou nenhuma) para os lancamentos selecionados. */
export function BulkCategoryDialog({ count, categories, onConfirm, onClose }: CategoryProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!value) {
      setError(t("transactions.bulk.categoryRequired"));
      return;
    }
    setBusy(true);
    await onConfirm(value === NONE ? null : value);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("transactions.bulkDialogs.mudarACategoria")}</DialogTitle>
          <DialogDescription>
            {t("transactions.bulk.categoryAppliesTo", { entries: entriesText(count) })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          <FormField id="bulk-category" label={t("common.categoria")} error={error ?? undefined}>
            {(props) => (
              <Select
                {...props}
                value={value}
                disabled={busy}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
              >
                <option value="">{t("transactions.bulkDialogs.escolhaACategoria")}</option>
                <option value={NONE}>{t("transactions.bulkDialogs.semCategoriaTirarA")}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t("transactions.bulkDialogs.mudando") : t("transactions.bulkDialogs.mudarCategoria")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DateProps = {
  count: number;
  onConfirm: (date: string) => Promise<unknown>;
  onClose: () => void;
};

/** Escolhe a data nova para os lancamentos selecionados. */
export function BulkDateDialog({ count, onConfirm, onClose }: DateProps) {
  const { t } = useTranslation();
  const [date, setDate] = useState(appToday());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError(t("validation.dateInvalid"));
      return;
    }
    setBusy(true);
    await onConfirm(date);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("transactions.bulkDialogs.mudarAData")}</DialogTitle>
          <DialogDescription>{t("transactions.bulk.dateAppliesTo", { entries: entriesText(count) })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          <FormField id="bulk-date" label={t("common.data")} error={error ?? undefined}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={date}
                disabled={busy}
                onChange={(event) => {
                  setDate(event.target.value);
                  setError(null);
                }}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t("transactions.bulkDialogs.mudando") : t("transactions.bulkDialogs.mudarData")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

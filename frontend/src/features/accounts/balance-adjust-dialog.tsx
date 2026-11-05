import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCurrencies, useUpdateAccount, type Account } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { FormField } from "@/components/form-field";
import { MoneyInput } from "@/components/money-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { appToday } from "@/lib/dates";
import { formatMoney, isNegativeMoney, negateMoney, parseMoneyInput, placesOf } from "@/lib/money";

type Props = { account: Account; onClose: () => void };

export function BalanceAdjustDialog({ account, onClose }: Props) {
  const { t } = useTranslation();
  const currencies = useCurrencies();
  const update = useUpdateAccount();

  const placesMap = Object.fromEntries((currencies.data ?? []).map((c) => [c.code, c.decimal_places]));
  const places = placesOf(account.currency_code, placesMap);

  const isLiability = account.type === "liability";
  // Exibe o saldo no sentido da tela (positivo para passivo)
  const shownBalance = isLiability && isNegativeMoney(account.balance)
    ? negateMoney(account.balance)
    : account.balance;

  const [value, setValue] = useState(shownBalance.replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (update.isPending) return;
    setError(null);
    setFieldError(null);

    const parsed = parseMoneyInput(value, places);
    if (!parsed.ok) {
      setFieldError(parsed.error);
      return;
    }
    if (isLiability && parsed.value.startsWith("-")) {
      setFieldError(t("accounts.accountFormDialog.debtPositive"));
      return;
    }

    try {
      await update.mutateAsync({
        id: account.id,
        body: { opening_balance: parsed.value, opening_balance_date: appToday() },
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !update.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("accounts.balanceAdjustDialog.titulo")}</DialogTitle>
          <DialogDescription>
            {t("accounts.balanceAdjustDialog.descricao", { name: account.name })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}

          <p className="text-sm text-muted-foreground">
            {t("accounts.balanceAdjustDialog.saldoAtual")}:{" "}
            <span className="font-medium text-foreground">
              {formatMoney(shownBalance, account.currency_code)}
            </span>
          </p>

          <FormField
            id="adjust-value"
            label={isLiability
              ? t("accounts.balanceAdjustDialog.novoValorDevido")
              : t("accounts.balanceAdjustDialog.novoSaldo")}
            error={fieldError ?? undefined}
            hint={t("accounts.balanceAdjustDialog.hint")}
          >
            {(props) => (
              <MoneyInput
                {...props}
                signed={!isLiability}
                places={places}
                value={value}
                onChange={(text) => {
                  setValue(text);
                  setFieldError(null);
                }}
              />
            )}
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
              {t("common.cancelar")}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending
                ? t("accounts.balanceAdjustDialog.ajustando")
                : t("accounts.balanceAdjustDialog.ajustar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

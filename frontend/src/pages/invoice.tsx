import { ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAccounts } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { useInvoice } from "@/api/invoices";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TransactionFormDialog } from "@/features/transactions/transaction-form-dialog";
import { appToday, firstOfMonth, formatDate, formatMonthYear, shiftMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export default function InvoicePage() {
  const { t } = useTranslation();
  const { accountId } = useParams<{ accountId: string }>();
  const currentMonth = firstOfMonth(appToday());
  const [month, setMonth] = useState(currentMonth);
  const [payDialog, setPayDialog] = useState(false);

  const accounts = useAccounts({ includeArchived: true });
  const account = accounts.data?.find((item) => item.id === accountId);
  const configured = account?.role === "credit_card" && account.closing_day != null && account.due_day != null;

  const invoice = useInvoice({ accountId: accountId ?? "", on: month });
  const enabled = Boolean(accountId) && configured;

  if (accounts.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("common.carregando")}
      </p>
    );
  }

  if (accounts.isError) {
    return <Alert variant="destructive">{getErrorMessage(accounts.error)}</Alert>;
  }

  if (!account) {
    return <Alert variant="destructive">{t("pages.invoice.contaNaoEncontrada")}</Alert>;
  }

  if (!configured) {
    return (
      <>
        <PageHeader title={t("pages.invoice.titulo", { name: account.name })} />
        <EmptyState
          icon={Receipt}
          title={t("pages.invoice.titulo", { name: account.name })}
          description={t("pages.invoice.contaNaoConfigurada")}
          action={
            <Button asChild variant="outline">
              <Link to="/contas">{t("pages.invoice.voltarParaContas")}</Link>
            </Button>
          }
        />
      </>
    );
  }

  let content;
  if (!enabled || invoice.isPending) {
    content = (
      <p role="status" className="text-sm text-muted-foreground">
        {t("pages.invoice.carregandoFatura")}
      </p>
    );
  } else if (invoice.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(invoice.error)}
        </Alert>
        <Button variant="outline" onClick={() => void invoice.refetch()}>
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else {
    const data = invoice.data!;
    content = (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t("pages.invoice.total")}</p>
            <p className="text-2xl font-semibold tracking-tight">{formatMoney(data.total, data.currency_code)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("pages.invoice.periodo")}</p>
            <p className="text-sm font-medium">
              {formatDate(data.period_start)} - {formatDate(data.period_end)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("pages.invoice.vencimento")}</p>
            <p className="text-sm font-medium">{formatDate(data.due_date)}</p>
          </div>
        </div>

        <div>
          <Button onClick={() => setPayDialog(true)}>{t("pages.invoice.marcarComoPaga")}</Button>
        </div>

        {data.splits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pages.invoice.nenhumaCompraNessaFatura")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.splits.map((split) => (
              <li key={split.id} className="flex items-center justify-between gap-3 rounded-md border bg-card px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{split.description}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(split.date)}</span>
                </div>
                <span className="shrink-0 text-sm font-semibold">{formatMoney(split.amount, split.currency_code)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader title={t("pages.invoice.titulo", { name: account.name })} description={t("pages.invoice.descricao")} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" className="shrink-0" aria-label={t("pages.invoice.mesAnterior")} onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft />
        </Button>
        <p className="min-w-36 text-center text-sm font-medium first-letter:uppercase" aria-live="polite">
          {formatMonthYear(month)}
        </p>
        <Button variant="outline" size="icon" className="shrink-0" aria-label={t("pages.invoice.proximoMes")} onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight />
        </Button>
        {month !== currentMonth && (
          <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth)}>
            {t("pages.invoice.mesAtual")}
          </Button>
        )}
      </div>

      {content}

      {payDialog && account && invoice.data && (
        <TransactionFormDialog
          initialTemplate={{
            date: appToday(),
            template: {
              splits: [
                {
                  type: "transfer",
                  date: appToday(),
                  currency_code: account.currency_code,
                  account_id: "",
                  counterparty_account_id: account.id,
                  description: t("pages.invoice.descricaoDoPagamento", { name: account.name }),
                  amount: invoice.data.total,
                },
              ],
            },
          }}
          onClose={() => setPayDialog(false)}
        />
      )}
    </>
  );
}

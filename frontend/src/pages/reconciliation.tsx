import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAccounts } from "@/api/accounts";
import { getErrorMessage } from "@/api/error-messages";
import { useCloseReconciliation, useReconciliation, useSetCleared, type Statement } from "@/api/reconciliation";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AdjustmentDialog } from "@/features/reconciliation/adjustment-dialog";
import { HistoryList } from "@/features/reconciliation/history-list";
import { clearedCount, differenceInfo, lockedText, truncatedText } from "@/features/reconciliation/presentation";
import { ReconciliationTable } from "@/features/reconciliation/reconciliation-table";
import { StatementForm } from "@/features/reconciliation/statement-form";

function Figure({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "ok" && "text-positive", tone === "warn" && "text-destructive")}>
        {value}
      </p>
    </div>
  );
}

function Work({ statement }: { statement: Statement }) {
  const view = useReconciliation(statement);
  const setCleared = useSetCleared(statement.accountId);
  const close = useCloseReconciliation(statement.accountId);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (view.isPending) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Carregando conciliação...
      </p>
    );
  }
  if (view.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(view.error)}
        </Alert>
        <Button variant="outline" onClick={() => void view.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  const data = view.data;
  const currency = data.currency_code;
  const info = differenceInfo(data.difference, currency);
  const nothingToClose = clearedCount(data.rows) === 0 && !data.truncated;
  const busy = setCleared.isPending || close.isPending;

  async function toggle(splitIds: string[], cleared: boolean) {
    if (splitIds.length === 0) return;
    setError(null);
    setNotice(null);
    try {
      await setCleared.mutateAsync({ splitIds, cleared });
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  async function closeReconciliation() {
    setError(null);
    setNotice(null);
    try {
      const result = await close.mutateAsync(statement);
      setNotice(`Conciliação fechada. ${lockedText(result.locked_count)}.`);
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && (
        <Alert role="status" className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-positive" aria-hidden="true" />
          {notice}
        </Alert>
      )}

      <section aria-label="Resumo" className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Figure label={`Saldo do extrato em ${formatDate(data.statement_date)}`} value={formatMoney(data.statement_balance, currency)} />
          <Figure label="Conferido" value={formatMoney(data.cleared_balance, currency)} />
          <Figure
            label="Diferença"
            value={formatMoney(data.difference, currency)}
            tone={info.tone === "ok" ? "ok" : "warn"}
          />
        </div>
        <p className="text-sm" role="status">
          {info.text}
        </p>
        <p className="text-xs text-muted-foreground">
          Saldo da conta {data.account_name} no app nessa data: {formatMoney(data.book_balance, currency)}. O conferido começa pelo saldo
          inicial e soma só o que você marcou abaixo.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {info.tone !== "ok" && (
            <Button variant="outline" onClick={() => setAdjusting(true)} disabled={busy}>
              Criar lançamento de ajuste
            </Button>
          )}
          {info.tone === "ok" && (
            <>
              <Button onClick={() => void closeReconciliation()} disabled={busy || nothingToClose}>
                {close.isPending ? "Fechando..." : "Fechar conciliação"}
              </Button>
              {nothingToClose && (
                <p className="text-xs text-muted-foreground">Marque ao menos um lançamento como conferido para fechar.</p>
              )}
            </>
          )}
        </div>
      </section>

      <section aria-label="Lançamentos" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Lançamentos até {formatDate(data.statement_date)}</h2>
        {truncatedText(data) && <Alert>{truncatedText(data)}</Alert>}
        <ReconciliationTable rows={data.rows} currencyCode={currency} pending={busy} onToggle={(ids, cleared) => void toggle(ids, cleared)} />
      </section>

      {adjusting && <AdjustmentDialog statement={statement} view={data} onClose={() => setAdjusting(false)} />}
    </div>
  );
}

export default function ReconciliationPage() {
  const accountsQuery = useAccounts({ includeArchived: false });
  const [statement, setStatement] = useState<Statement | null>(null);

  // So conta de ativo se concilia com um extrato (o servidor tambem recusa dividas)
  const accounts = (accountsQuery.data ?? []).filter((account) => account.type === "asset");
  const account = accounts.find((item) => item.id === statement?.accountId);

  let form;
  if (accountsQuery.isPending) {
    form = (
      <p className="text-sm text-muted-foreground" role="status">
        Carregando contas...
      </p>
    );
  } else if (accountsQuery.isError) {
    form = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(accountsQuery.error)}
        </Alert>
        <Button variant="outline" onClick={() => void accountsQuery.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else if (accounts.length === 0) {
    form = (
      <Alert>
        Você ainda não tem uma conta para conciliar. <Link to="/contas" className="font-medium underline">Crie uma conta</Link> primeiro.
      </Alert>
    );
  } else {
    form = <StatementForm accounts={accounts} onApply={setStatement} />;
  }

  return (
    <>
      <PageHeader
        title="Conciliar"
        description="Confira os lançamentos da conta com o extrato do banco. Quando o conferido bate com o extrato, feche a conciliação."
      />
      <div className="flex flex-col gap-8">
        {form}
        {statement && <Work key={`${statement.accountId}|${statement.balance}|${statement.date}`} statement={statement} />}
        {statement && account && (
          <section aria-label="Histórico" className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Conciliações fechadas</h2>
            <HistoryList accountId={statement.accountId} currencyCode={account.currency_code} />
          </section>
        )}
      </div>
    </>
  );
}

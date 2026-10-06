import { useId, type ReactNode } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

type Props = {
  title: string;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry: () => void;
  isEmpty?: boolean;
  empty?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * Casca comum de um bloco do painel: titulo (h2 com regiao nomeada para leitor de tela),
 * carregando, erro (so desse bloco, com "Tentar de novo" que nao mexe nos outros) e vazio.
 * Um bloco que falha nunca derruba os demais, porque cada um e isolado aqui.
 */
export function DashboardBlock({
  title,
  isLoading,
  isError,
  error,
  onRetry,
  isEmpty,
  empty,
  actions,
  className,
  children,
}: Props) {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={`min-w-0 rounded-lg border bg-card p-4 ${className ?? ""}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold text-primary-text">
          {title}
        </h2>
        {actions}
      </div>

      {isLoading && (
        <div aria-busy="true" className="flex flex-col gap-2">
          <div className="h-20 animate-pulse rounded-md bg-muted" />
          <p className="sr-only" role="status">
            {t("dashboard.dashboardBlock.loading", { title: title.toLowerCase() })}
          </p>
        </div>
      )}

      {!isLoading && isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert variant="destructive" className="w-full">
            {getErrorMessage(error)}
          </Alert>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("common.tentarDeNovo")}
          </Button>
        </div>
      )}

      {!isLoading && !isError && isEmpty && empty}
      {!isLoading && !isError && !isEmpty && children}
    </section>
  );
}

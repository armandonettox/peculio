import { AlertTriangle, KeyRound } from "lucide-react";
import { useState } from "react";

import { MAX_API_TOKENS, useApiTokens, type ApiToken } from "@/api/api-tokens";
import { getErrorMessage } from "@/api/error-messages";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { appToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { CreateApiTokenDialog } from "./create-api-token-dialog";
import { expiryOf, lastUsedText, needingAttention, prefixText, scopeLabel } from "./presentation";
import { RevokeApiTokenDialog } from "./revoke-api-token-dialog";

type DialogState = { kind: "create" } | { kind: "revoke"; token: ApiToken } | null;

/** Tokens de API: lista, criar e revogar. O valor de um token so aparece na hora em que ele e criado. */
export function ApiTokensSection() {
  const query = useApiTokens();
  const [dialog, setDialog] = useState<DialogState>(null);
  const today = appToday();
  const tokens = query.data ?? [];
  const full = tokens.length >= MAX_API_TOKENS;

  let body;
  if (query.isPending) {
    body = (
      <div aria-busy="true" className="h-20 animate-pulse rounded-md border bg-muted">
        <p className="sr-only" role="status">
          Carregando tokens...
        </p>
      </div>
    );
  } else if (query.isError) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(query.error)}
        </Alert>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else {
    const attention = needingAttention(tokens, today);
    body = (
      <div className="flex flex-col gap-4">
        {attention > 0 && (
          <Alert variant="destructive" role="alert">
            {attention === 1
              ? "1 token venceu ou vence em breve. Crie um novo e revogue o antigo."
              : `${attention} tokens venceram ou vencem em breve. Crie novos e revogue os antigos.`}
          </Alert>
        )}

        {tokens.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <KeyRound className="size-4" aria-hidden="true" />
            Você ainda não tem nenhum token.
          </p>
        ) : (
          <ul aria-label="Tokens de API" className="flex flex-col divide-y rounded-md border">
            {tokens.map((token) => {
              const expiry = expiryOf(token, today);
              const warn = expiry.state === "expired" || expiry.state === "soon";
              return (
                <li key={token.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{token.name}</h3>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {scopeLabel(token.scope)}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{prefixText(token)}</p>
                    <p className={cn("flex items-center gap-1 text-xs", warn ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {warn && <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />}
                      {expiry.text}
                    </p>
                    <p className="text-xs text-muted-foreground">{lastUsedText(token)}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    aria-label={`Revogar o token ${token.name}`}
                    onClick={() => setDialog({ kind: "revoke", token })}
                  >
                    Revogar
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setDialog({ kind: "create" })} disabled={full}>
            Criar token
          </Button>
          {full && (
            <p className="text-xs text-muted-foreground">
              Você chegou ao limite de {MAX_API_TOKENS} tokens. Revogue algum para criar outro.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Card className="mt-6 max-w-2xl">
        <CardHeader>
          <CardTitle as="h2">Tokens de API</CardTitle>
          <CardDescription>
            Para scripts e integrações acessarem seus dados sem usar sua senha. Cada token tem permissão e validade.
          </CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>

      {dialog?.kind === "create" && <CreateApiTokenDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "revoke" && <RevokeApiTokenDialog token={dialog.token} onClose={() => setDialog(null)} />}
    </>
  );
}

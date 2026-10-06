import { useState } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useRevokeOtherSessions, useRevokeSession, useSessions, type AuthSession } from "@/api/sessions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { devicesText, lastUsedLabel, otherDevicesCount, sortDevices } from "./devices-model";

/** Onde a conta esta aberta. Cada aparelho pode ser encerrado: o acesso dele acaba na hora. */
export function DevicesSection() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();

  async function endOne(session: AuthSession) {
    setNotice(null);
    setError(null);
    try {
      await revoke.mutateAsync(session.id);
      setNotice(`${session.device_label} foi encerrado.`);
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  async function endOthers() {
    setNotice(null);
    setError(null);
    try {
      const result = await revokeOthers.mutateAsync();
      setNotice(`${devicesText(result.revoked)} encerrado${result.revoked === 1 ? "" : "s"}.`);
    } catch (failure) {
      setError(getErrorMessage(failure));
    }
  }

  let body;
  if (sessions.isPending) {
    body = (
      <p className="text-sm text-muted-foreground" role="status">
        Carregando...
      </p>
    );
  } else if (sessions.isError) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(sessions.error)}
        </Alert>
        <Button variant="outline" size="sm" onClick={() => void sessions.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  } else {
    const rows = sortDevices(sessions.data);
    const others = otherDevicesCount(rows);
    const busy = revoke.isPending || revokeOthers.isPending;
    body = (
      <div className="flex flex-col gap-4">
        {error && <Alert variant="destructive">{error}</Alert>}
        {notice && (
          <p role="status" className="rounded-md border bg-accent/30 px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        <ul className="flex flex-col divide-y rounded-lg border">
          {rows.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{session.device_label}</span>
                {session.current && (
                  <span className="ml-2 rounded-md bg-accent px-1.5 py-0.5 text-xs">Este aparelho</span>
                )}
                {session.remember && <span className="ml-2 text-xs text-muted-foreground">Manter conectado</span>}
                <span className="block text-xs text-muted-foreground">
                  Entrou em {formatDate(session.created_at.slice(0, 10))} · usado {lastUsedLabel(session.last_used_at, now)}
                </span>
              </span>
              {!session.current && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void endOne(session)}
                  aria-label={`Encerrar ${session.device_label}, usado ${lastUsedLabel(session.last_used_at, now)}`}
                >
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
        {others > 0 && (
          <div>
            <Button variant="outline" disabled={busy} onClick={() => void endOthers()}>
              {others === 1 ? "Encerrar o outro aparelho" : `Encerrar os outros ${others} aparelhos`}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="mt-6 max-w-2xl">
      <CardHeader>
        <CardTitle>Aparelhos conectados</CardTitle>
        <CardDescription>
          Onde a sua conta está aberta. Encerrar um aparelho acaba com o acesso dele na hora. Trocar a senha encerra todos
          os outros.
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

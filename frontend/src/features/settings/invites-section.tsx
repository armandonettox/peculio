import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useCreateInvite, useInvites, useRevokeInvite, type Invite, type InviteCreated } from "@/api/invites";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { emailError } from "@/auth/validation";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { inviteLink, inviteState } from "./model";
import { Trans, useTranslation } from "react-i18next";

/** Convites para outras pessoas entrarem (so o administrador ve). O codigo do convite aparece uma vez, ao criar. */
export function InvitesSection() {
  const { t } = useTranslation();
  const invites = useInvites();
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const [email, setEmail] = useState("");
  const [emailProblem, setEmailProblem] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<InviteCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<Invite | null>(null);
  const now = new Date();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    const problem = emailError(email);
    setEmailProblem(problem);
    if (problem) return document.getElementById("settings-invite-email")?.focus();
    try {
      setCreated(await create.mutateAsync(email.trim()));
      setCopied(false);
      setEmail("");
    } catch (failure) {
      setServerError(getErrorMessage(failure));
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Sem permissao para copiar: o link continua na tela para copiar a mao
    }
  }

  let list;
  if (invites.isPending) {
    list = (
      <p className="text-sm text-muted-foreground" role="status">
        {t("settings.invitesSection.carregandoConvites")}
      </p>
    );
  } else if (invites.isError) {
    list = (
      <div className="flex flex-col items-start gap-2">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(invites.error)}
        </Alert>
        <Button variant="outline" size="sm" onClick={() => void invites.refetch()}>
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else if (invites.data.length === 0) {
    list = <p className="text-sm text-muted-foreground">{t("settings.invitesSection.nenhumConviteCriadoAinda")}</p>;
  } else {
    list = (
      <ul className="flex flex-col divide-y rounded-lg border">
        {invites.data.map((invite) => {
          const state = inviteState(invite, now);
          return (
            <li key={invite.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{invite.email}</span>
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-xs",
                  state.kind === "pending" ? "bg-accent text-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {state.label}
              </span>
              <span className="text-xs text-muted-foreground">{t("settings.invitesSection.criadoEm", { date: formatDate(invite.created_at.slice(0, 10)) })}</span>
              {state.kind === "pending" && (
                <Button size="sm" variant="outline" onClick={() => setRemoving(invite)} aria-label={t("settings.invitesSection.revogarOConviteDe", { email: invite.email })}>
                  {t("common.revogar")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("settings.invitesSection.usuariosEConvites")}</CardTitle>
        <CardDescription>{t("settings.invitesSection.soQuemRecebeUm")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <FormField id="settings-invite-email" label={t("settings.invitesSection.eMailDaPessoa")} error={emailProblem}>
              {(field) => (
                <Input
                  {...field}
                  type="email"
                  autoComplete="off"
                  value={email}
                  disabled={create.isPending}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setEmailProblem(undefined);
                  }}
                />
              )}
            </FormField>
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t("settings.invitesSection.criando") : t("settings.invitesSection.criarConvite")}
          </Button>
        </form>

        {serverError && <Alert variant="destructive">{serverError}</Alert>}

        {created && (
          <div role="status" className="flex flex-col gap-2 rounded-md border bg-accent/30 p-3 text-sm">
            <p>
              <Trans
                i18nKey="settings.invitesSection.conviteCriadoPara"
                values={{ email: created.email }}
                components={{ strong: <strong /> }}
              />
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{inviteLink(window.location.origin, created.token)}</code>
              <Button size="sm" variant="outline" onClick={() => void copy(inviteLink(window.location.origin, created.token))}>
                <Copy />
                {copied ? t("settings.invitesSection.copiado") : t("settings.invitesSection.copiarLink")}
              </Button>
            </div>
          </div>
        )}

        {list}
      </CardContent>

      {removing && (
        <ConfirmDeleteDialog
          title={t("settings.invitesSection.revogarConvite")}
          itemName={t("settings.invitesSection.oConviteDe", { email: removing.email })}
          consequence={t("settings.invitesSection.oLinkDeixaDe")}
          onConfirm={() => revoke.mutateAsync(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </Card>
  );
}

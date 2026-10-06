import { useState, type FormEvent } from "react";

import { getErrorMessage } from "@/api/error-messages";
import { useSecurityContact, useUpdateSecurityContact } from "@/api/instance";
import { FormField } from "@/components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { securityContactError } from "./model";
import { Trans, useTranslation } from "react-i18next";

const FIELD_ID = "settings-security-contact";

/** A quem as pessoas desta instalacao devem relatar um problema de seguranca (so o administrador edita). */
export function SecurityContactSection() {
  const { t } = useTranslation();
  const current = useSecurityContact();
  const update = useUpdateSecurityContact();
  // null = o campo ainda nao foi mexido: mostra o que esta salvo
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const saved = current.data?.contact ?? "";
  const value = typed ?? saved;
  const changed = value.trim() !== saved;

  async function save(contact: string, message: string) {
    setNotice(null);
    setServerError(null);
    try {
      await update.mutateAsync(contact.trim() || null);
      setTyped(null);
      setNotice(message);
    } catch (failure) {
      setServerError(getErrorMessage(failure));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = securityContactError(value);
    setProblem(found);
    if (found) return document.getElementById(FIELD_ID)?.focus();
    if (!changed) return;
    void save(value, value.trim() ? t("settings.securityContactSection.contatoSalvo") : t("settings.securityContactSection.contatoRemovido"));
  }

  let body;
  if (current.isPending) {
    body = (
      <p className="text-sm text-muted-foreground" role="status">
        {t("common.carregando")}
      </p>
    );
  } else if (current.isError) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(current.error)}
        </Alert>
        <Button variant="outline" size="sm" onClick={() => void current.refetch()}>
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {serverError && <Alert variant="destructive">{serverError}</Alert>}
        {notice && (
          <p role="status" className="rounded-md border bg-accent/30 px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        <FormField
          id={FIELD_ID}
          label={t("settings.securityContactSection.contatoDeSeguranca")}
          error={problem}
          hint={t("settings.securityContactSection.umEMailOu")}
        >
          {(field) => (
            <Input
              {...field}
              autoComplete="off"
              value={value}
              disabled={update.isPending}
              onChange={(event) => {
                setTyped(event.target.value);
                setProblem(undefined);
                setNotice(null);
              }}
            />
          )}
        </FormField>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={update.isPending || !changed}>
            {update.isPending ? t("settings.securityContactSection.salvando") : t("settings.securityContactSection.salvarContato")}
          </Button>
          {saved && (
            <Button type="button" variant="outline" disabled={update.isPending} onClick={() => void save("", t("settings.securityContactSection.contatoRemovido"))}>
              {t("settings.securityContactSection.removerContato")}
            </Button>
          )}
        </div>
        {saved && (
          <p className="text-xs text-muted-foreground">
            <Trans
              i18nKey="settings.securityContactSection.publicadoEm"
              components={{ wk: <a className="underline" href="/.well-known/security.txt" /> }}
            />
          </p>
        )}
      </form>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("settings.securityContactSection.contatoDeSeguranca")}</CardTitle>
        <CardDescription>
          {t("settings.securityContactSection.aQuemAsPessoas")}
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

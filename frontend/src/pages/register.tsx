import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/errors";
import { getErrorMessage } from "@/api/error-messages";
import { useAuth } from "@/auth/auth-context";
import { useAuthStatus } from "@/auth/use-auth-status";
import { emailError, passwordError, requiredError } from "@/auth/validation";
import { FormField } from "@/components/form-field";
import { PasswordInput } from "@/components/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";

type Field = "name" | "email" | "password" | "invite";
type FieldErrors = Partial<Record<Field, string>>;

const FIELD_ORDER: Field[] = ["name", "email", "password", "invite"];

// O backend chama o campo de invite_token
function toField(serverField: string): Field | null {
  if (serverField === "invite_token") return "invite";
  return (["name", "email", "password"] as const).find((field) => field === serverField) ?? null;
}

export default function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const status = useAuthStatus();
  const [searchParams] = useSearchParams();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // O link de convite ja traz o codigo: /register?invite=...
  const [invite, setInvite] = useState(searchParams.get("invite") ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status.isPending) {
    return (
      <p role="status" className="text-center text-sm text-muted-foreground">
        {t("pages.register.verificandoAInstancia")}
      </p>
    );
  }

  if (status.isError) {
    return (
      <div className="flex flex-col items-center gap-4">
        <Alert variant="destructive" className="w-full">
          {getErrorMessage(status.error)}
        </Alert>
        <Button variant="outline" onClick={() => void status.refetch()}>
          {t("common.tentarDeNovo")}
        </Button>
      </div>
    );
  }

  const setupRequired = status.data.setup_required;

  // Troca o valor do campo e apaga o erro dele: o erro some assim que o usuario volta a digitar
  function change(field: Field, setValue: (value: string) => void) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setValue(event.target.value);
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const found: FieldErrors = {
      name: requiredError(name, t("pages.register.nameRequired")),
      email: emailError(email),
      password: passwordError(password),
      invite: setupRequired ? undefined : requiredError(invite, t("pages.register.inviteRequired")),
    };
    setErrors(found);
    setFormError(null);
    const firstInvalid = FIELD_ORDER.find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`register-${firstInvalid}`)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      // Ao concluir, o PublicOnlyRoute leva para o painel
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        inviteToken: setupRequired ? undefined : invite.trim(),
      });
    } catch (error) {
      setSubmitting(false);
      const message = getErrorMessage(error);
      if (error instanceof ApiError) {
        const serverErrors: FieldErrors = {};
        for (const item of error.fieldErrors) {
          const field = toField(item.field);
          if (field) serverErrors[field] = item.message;
        }
        // E-mail repetido e um erro do campo, nao do formulario inteiro
        if (error.code === "email_already_registered") serverErrors.email = message;
        if (Object.keys(serverErrors).length > 0) {
          setErrors(serverErrors);
          if (error.code === "validation_error") setFormError(message);
          const firstServerError = FIELD_ORDER.find((field) => serverErrors[field]);
          if (firstServerError) document.getElementById(`register-${firstServerError}`)?.focus();
          return;
        }
      }
      setFormError(message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{setupRequired ? t("pages.register.criarContaDeAdministrador") : t("pages.register.criarConta")}</CardTitle>
        <CardDescription>
          {setupRequired
            ? t("pages.register.primeiroAcessoEstaConta")
            : t("pages.register.useOConviteEnviado")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="register-name" label={t("common.nome")} error={errors.name}>
            {(props) => (
              <Input {...props} autoComplete="name" value={name} onChange={change("name", setName)} />
            )}
          </FormField>

          <FormField id="register-email" label={t("common.eMail")} error={errors.email}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="username"
                value={email}
                onChange={change("email", setEmail)}
              />
            )}
          </FormField>

          <FormField id="register-password" label={t("common.senha")} error={errors.password} hint={t("pages.register.minimoDe8Caracteres")}>
            {(props) => (
              <PasswordInput
                {...props}
                autoComplete="new-password"
                value={password}
                onChange={change("password", setPassword)}
              />
            )}
          </FormField>

          {!setupRequired && (
            <FormField id="register-invite" label={t("pages.register.codigoDoConvite")} error={errors.invite}>
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  value={invite}
                  onChange={change("invite", setInvite)}
                />
              )}
            </FormField>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting ? t("pages.register.criandoConta") : t("pages.register.criarConta")}
          </Button>

          {!setupRequired && (
            <p className="text-center text-sm text-muted-foreground">
              {t("pages.register.haveAccount")}{" "}
              <Link to="/login" className="font-medium text-primary-text underline-offset-4 hover:underline">
                {t("pages.register.entrar")}
              </Link>
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

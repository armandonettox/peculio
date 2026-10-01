import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";

import { getErrorMessage } from "@/api/error-messages";
import { useAuth } from "@/auth/auth-context";
import { useAuthStatus } from "@/auth/use-auth-status";
import { emailError, requiredError } from "@/auth/validation";
import { FormField } from "@/components/form-field";
import { PasswordInput } from "@/components/password-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type FieldErrors = { email?: string; password?: string };

export default function LoginPage() {
  const { login } = useAuth();
  const status = useAuthStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Instancia sem nenhum usuario: nao ha com quem entrar, o caminho e criar o administrador
  if (status.data?.setup_required) return <Navigate to="/register" replace />;

  // O erro de um campo some assim que o usuario volta a digitar nele
  function clearError(field: keyof FieldErrors) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const found: FieldErrors = {
      email: emailError(email),
      // No login nao se valida o tamanho: so exige que tenha algo digitado
      password: requiredError(password, "Informe a senha."),
    };
    setErrors(found);
    setFormError(null);
    const firstInvalid = (["email", "password"] as const).find((field) => found[field]);
    if (firstInvalid) {
      document.getElementById(`login-${firstInvalid}`)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      // Ao entrar, o PublicOnlyRoute leva para o ?next= ou para o painel
      await login({ email: email.trim(), password });
    } catch (error) {
      setFormError(getErrorMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Acesse sua conta para ver suas finanças.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}

          <FormField id="login-email" label="E-mail" error={errors.email}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearError("email");
                }}
              />
            )}
          </FormField>

          <FormField id="login-password" label="Senha" error={errors.password}>
            {(props) => (
              <PasswordInput
                {...props}
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearError("password");
                }}
              />
            )}
          </FormField>

          <Button type="submit" disabled={submitting}>
            {submitting ? "Entrando..." : "Entrar"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Recebeu um convite?{" "}
            <Link to="/register" className="font-medium text-primary-text underline-offset-4 hover:underline">
              Criar conta
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

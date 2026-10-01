import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";

import { getErrorMessage } from "@/api/error-messages";
import { ApiError } from "@/api/errors";
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

// Segundo passo para contas com 2FA: o codigo do app autenticador ou um codigo de recuperacao
function TwoFactorStep({ challenge, onBack }: { challenge: string; onBack: (message?: string) => void }) {
  const { verifyTwoFactor } = useAuth();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const missing = requiredError(code, recovery ? "Informe o código de recuperação." : "Informe o código de 6 dígitos.");
    setFieldError(missing);
    if (missing) {
      document.getElementById("login-code")?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await verifyTwoFactor(challenge, code.trim());
    } catch (failure) {
      // Desafio vencido ou invalido: nao adianta tentar de novo, volta para a senha
      if (failure instanceof ApiError && failure.code === "two_factor_challenge_invalid") {
        onBack(getErrorMessage(failure));
        return;
      }
      setError(getErrorMessage(failure));
      setSubmitting(false);
    }
  }

  function toggleRecovery() {
    setRecovery((current) => !current);
    setCode("");
    setError(null);
    setFieldError(undefined);
    document.getElementById("login-code")?.focus();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verificação em duas etapas</CardTitle>
        <CardDescription>
          {recovery
            ? "Digite um dos códigos de recuperação que você guardou. Cada código vale uma vez só."
            : "Digite o código de 6 dígitos que aparece no seu app autenticador."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}

          <FormField id="login-code" label={recovery ? "Código de recuperação" : "Código de verificação"} error={fieldError}>
            {(props) => (
              <Input
                {...props}
                autoFocus
                autoComplete="one-time-code"
                inputMode={recovery ? "text" : "numeric"}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setFieldError(undefined);
                }}
              />
            )}
          </FormField>

          <Button type="submit" disabled={submitting}>
            {submitting ? "Verificando..." : "Verificar"}
          </Button>

          <div className="flex flex-col items-center gap-2 text-sm">
            <button
              type="button"
              onClick={toggleRecovery}
              className="font-medium text-primary-text underline-offset-4 hover:underline"
            >
              {recovery ? "Usar o código do app" : "Usar um código de recuperação"}
            </button>
            <button type="button" onClick={() => onBack()} className="text-muted-foreground underline-offset-4 hover:underline">
              Voltar
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const [challenge, setChallenge] = useState<string | null>(null);
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
      const outcome = await login({ email: email.trim(), password });
      if (outcome.status === "two_factor") {
        setChallenge(outcome.challengeToken);
        setSubmitting(false);
      }
    } catch (error) {
      setFormError(getErrorMessage(error));
      setSubmitting(false);
    }
  }

  if (challenge) {
    return (
      <TwoFactorStep
        challenge={challenge}
        onBack={(message) => {
          setChallenge(null);
          // A senha nao fica guardada: ao voltar, digita de novo
          setPassword("");
          setFormError(message ?? null);
        }}
      />
    );
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

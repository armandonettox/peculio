import { i18n } from "@/i18n";

// Validacoes de formulario que espelham as regras do backend (app/schemas/user.py).
// O servidor continua sendo quem decide; aqui so evitamos uma ida a rede por erro obvio.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
// O bcrypt ignora tudo depois de 72 bytes, por isso o backend recusa senha maior
const MAX_PASSWORD_BYTES = 72;

export function emailError(email: string): string | undefined {
  if (!email.trim()) return i18n.t("validation.emailRequired");
  if (!EMAIL_PATTERN.test(email.trim())) return i18n.t("validation.emailInvalid");
  return undefined;
}

export function passwordError(password: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return i18n.t("validation.passwordShort", { min: MIN_PASSWORD_LENGTH });
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return i18n.t("validation.passwordLong");
  return undefined;
}

export function requiredError(value: string, message: string): string | undefined {
  return value.trim() ? undefined : message;
}

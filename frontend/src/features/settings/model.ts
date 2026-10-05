import { emailError, passwordError } from "@/auth/validation";

// As regras das telas de Configuracoes, sem tela: validar os formularios, montar o link do convite e dizer em que pé ele
// esta. Ficam aqui, com testes, e as telas so as usam. O servidor continua decidindo: aqui so se evita uma ida a rede
// por erro obvio.

export const MAX_NAME_LENGTH = 200;

// ---------- Perfil ----------

export type ProfileForm = { name: string; currency: string };

export type ProfileErrors = { name?: string; currency?: string };

export function profileErrors(form: ProfileForm): ProfileErrors {
  const errors: ProfileErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Informe o nome.";
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Use no máximo ${MAX_NAME_LENGTH} letras.`;
  if (!form.currency) errors.currency = "Escolha a moeda.";
  return errors;
}

/** So o que mudou em relacao ao salvo: nao manda campo igual, e sem mudanca nao ha o que salvar (null). */
export function profileChanges(form: ProfileForm, saved: { name: string; default_currency: string }) {
  const changes: { name?: string; default_currency?: string } = {};
  const name = form.name.trim();
  if (name !== saved.name) changes.name = name;
  if (form.currency !== saved.default_currency) changes.default_currency = form.currency;
  return Object.keys(changes).length > 0 ? changes : null;
}

// ---------- Senha ----------

export type PasswordForm = { current: string; next: string; confirm: string };

export type PasswordErrors = { current?: string; next?: string; confirm?: string };

export function passwordFormErrors(form: PasswordForm): PasswordErrors {
  const errors: PasswordErrors = {};
  if (!form.current) errors.current = "Informe a senha atual.";
  const rule = passwordError(form.next);
  if (rule) errors.next = rule;
  else if (form.next === form.current) errors.next = "A nova senha precisa ser diferente da atual.";
  if (!errors.next && form.confirm !== form.next) errors.confirm = "As senhas não conferem.";
  return errors;
}

// ---------- Convites ----------

/** O link que a pessoa convidada abre: o cadastro ja vem com o codigo preenchido. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/register?invite=${encodeURIComponent(token)}`;
}

export type InviteState = { kind: "used" | "expired" | "pending"; label: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Em que pe esta o convite: ja usado, vencido ou esperando (com os dias que faltam). */
export function inviteState(invite: { used_at: string | null; expires_at: string }, now: Date): InviteState {
  if (invite.used_at) return { kind: "used", label: "Usado" };
  const left = new Date(invite.expires_at).getTime() - now.getTime();
  if (left <= 0) return { kind: "expired", label: "Vencido" };
  const days = Math.ceil(left / DAY_MS);
  return { kind: "pending", label: days === 1 ? "Vence em 1 dia" : `Vence em ${days} dias` };
}

// ---------- Contato de seguranca ----------

export const MAX_CONTACT_LENGTH = 200;

/** Vazio e permitido (apaga o contato). Senao: um e-mail ou um endereco https://, como o servidor exige. */
export function securityContactError(value: string): string | undefined {
  const contact = value.trim();
  if (!contact) return undefined;
  if (contact.length > MAX_CONTACT_LENGTH) return `Use no máximo ${MAX_CONTACT_LENGTH} caracteres.`;
  if (contact.toLowerCase().startsWith("https://")) {
    let url: URL;
    try {
      url = new URL(contact);
    } catch {
      return "O endereço https:// não é válido.";
    }
    if (!url.host || url.username || url.password || /\s/.test(contact)) return "O endereço https:// não é válido.";
    return undefined;
  }
  // Dois pontos nao existem num e-mail comum e denunciam "mailto:" ou "javascript:" colado no campo
  if (contact.includes(":") || emailError(contact)) {
    return "Informe um e-mail válido ou um endereço que comece com https://.";
  }
  return undefined;
}

/** O que o contato abre quando clicado: o proprio endereco https://, ou mailto: para e-mail. */
export function securityContactHref(contact: string): string {
  return contact.toLowerCase().startsWith("https://") ? contact : `mailto:${contact}`;
}

import { ApiError } from "./errors";

// Mensagem em portugues para cada codigo de erro do backend (app/core/errors.py, ErrorCode).
// Um teste confere que todo codigo do backend tem mensagem aqui.
export const ERROR_MESSAGES: Record<string, string> = {
  token_missing: "Sua sessão expirou. Entre novamente.",
  token_invalid: "Sua sessão expirou. Entre novamente.",
  session_expired: "Sua sessão expirou. Entre novamente.",
  session_invalid: "Sua sessão não é mais válida. Entre novamente.",
  user_not_found: "Usuário não encontrado.",
  invalid_credentials: "E-mail ou senha incorretos.",
  account_locked: "Conta bloqueada por excesso de tentativas. Tente de novo em alguns minutos.",
  admin_required: "Apenas administradores podem fazer isso.",
  invite_required: "O cadastro está disponível somente por convite.",
  invite_invalid: "Convite inválido ou expirado.",
  invite_not_found: "Convite não encontrado.",
  email_already_registered: "Este e-mail já está cadastrado.",
  validation_error: "Confira os dados informados.",
  rate_limited: "Muitas tentativas. Aguarde um instante e tente de novo.",
  not_found: "Não encontrado.",
  method_not_allowed: "Ação não permitida.",
  forbidden: "Você não tem permissão para isso.",
  unauthorized: "Você precisa entrar para continuar.",
  internal_error: "Algo deu errado do nosso lado. Tente novamente.",
  network_error: "Não foi possível conectar ao servidor. Verifique sua conexão.",
};

const FALLBACK_MESSAGE = "Algo deu errado. Tente novamente.";

// Mensagem para mostrar ao usuario. Codigo desconhecido cai no texto do servidor.
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? error.message ?? FALLBACK_MESSAGE;
  }
  return FALLBACK_MESSAGE;
}

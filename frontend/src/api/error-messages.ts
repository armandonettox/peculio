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
  two_factor_invalid_code: "Código inválido. Confira o app autenticador ou use um código de recuperação.",
  two_factor_challenge_invalid: "O tempo para informar o código acabou. Entre novamente.",
  two_factor_already_enabled: "A verificação em duas etapas já está ativada.",
  two_factor_not_enabled: "A verificação em duas etapas não está ativada.",
  two_factor_setup_required: "Gere o segredo antes de ativar a verificação em duas etapas.",
  invalid_password: "Senha incorreta.",
  invite_required: "O cadastro está disponível somente por convite.",
  invite_invalid: "Convite inválido ou expirado.",
  invite_not_found: "Convite não encontrado.",
  email_already_registered: "Este e-mail já está cadastrado.",
  category_not_found: "Categoria não encontrada.",
  category_name_taken: "Já existe uma categoria com esse nome.",
  tag_not_found: "Tag não encontrada.",
  tag_name_taken: "Já existe uma tag com esse nome.",
  transaction_not_found: "Transação não encontrada.",
  invalid_split_accounts: "Estas contas não podem ser usadas juntas neste lançamento.",
  currency_mismatch: "A moeda do lançamento não confere com a das contas.",
  account_not_found: "Conta não encontrada.",
  account_name_taken: "Já existe uma conta com esse nome.",
  account_has_transactions: "Esta conta tem transações e não pode ser excluída. Arquive-a em vez disso.",
  currency_not_found: "Moeda não encontrada.",
  invalid_amount: "Valor inválido para esta moeda.",
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

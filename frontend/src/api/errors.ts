export type FieldError = { field: string; message: string };

// Formato de erro do backend: { detail, code } e, no 422, tambem { errors: [{ field, message }] }
type ErrorBody = {
  detail?: unknown;
  code?: unknown;
  errors?: unknown;
  locked_ids?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];
  // Acao em massa recusada: os lancamentos travados por uma conciliacao fechada
  readonly lockedIds: string[];

  constructor(status: number, code: string, detail: string, fieldErrors: FieldError[] = [], lockedIds: string[] = []) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.lockedIds = lockedIds;
  }

  // Monta o erro a partir da resposta do servidor, mesmo que o corpo venha fora do formato
  static fromResponse(status: number, body: unknown): ApiError {
    const data: ErrorBody = typeof body === "object" && body !== null ? body : {};
    const detail = typeof data.detail === "string" ? data.detail : "Erro inesperado";
    const code = typeof data.code === "string" ? data.code : `http_${status}`;
    const fieldErrors = Array.isArray(data.errors)
      ? data.errors.filter(
          (e): e is FieldError =>
            typeof e === "object" && e !== null && typeof e.field === "string" && typeof e.message === "string",
        )
      : [];
    const lockedIds = Array.isArray(data.locked_ids) ? data.locked_ids.filter((id): id is string => typeof id === "string") : [];
    return new ApiError(status, code, detail, fieldErrors, lockedIds);
  }

  static network(): ApiError {
    return new ApiError(0, "network_error", "Falha de conexao com o servidor");
  }
}

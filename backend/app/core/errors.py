import logging
from enum import StrEnum

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("finance-app")


class ErrorCode(StrEnum):
    """Codigos estaveis de erro. O frontend traduz por eles, entao o texto em `detail`
    pode mudar sem quebrar ninguem. Nunca renomear um codigo ja publicado."""

    # Autenticacao e sessao
    TOKEN_MISSING = "token_missing"
    TOKEN_INVALID = "token_invalid"
    USER_NOT_FOUND = "user_not_found"
    INVALID_CREDENTIALS = "invalid_credentials"
    ACCOUNT_LOCKED = "account_locked"
    SESSION_EXPIRED = "session_expired"
    SESSION_INVALID = "session_invalid"
    ADMIN_REQUIRED = "admin_required"
    # Dois fatores (2FA)
    TWO_FACTOR_INVALID_CODE = "two_factor_invalid_code"
    TWO_FACTOR_CHALLENGE_INVALID = "two_factor_challenge_invalid"
    TWO_FACTOR_ALREADY_ENABLED = "two_factor_already_enabled"
    TWO_FACTOR_NOT_ENABLED = "two_factor_not_enabled"
    TWO_FACTOR_SETUP_REQUIRED = "two_factor_setup_required"
    INVALID_PASSWORD = "invalid_password"
    # Cadastro e convites
    INVITE_REQUIRED = "invite_required"
    INVITE_INVALID = "invite_invalid"
    INVITE_NOT_FOUND = "invite_not_found"
    EMAIL_ALREADY_REGISTERED = "email_already_registered"
    # Categorias e tags
    CATEGORY_NOT_FOUND = "category_not_found"
    CATEGORY_NAME_TAKEN = "category_name_taken"
    TAG_NOT_FOUND = "tag_not_found"
    TAG_NAME_TAKEN = "tag_name_taken"
    # Orcamentos
    BUDGET_NOT_FOUND = "budget_not_found"
    BUDGET_NAME_TAKEN = "budget_name_taken"
    BUDGET_NOT_ALLOWED = "budget_not_allowed"
    # Contas a pagar
    BILL_NOT_FOUND = "bill_not_found"
    BILL_NAME_TAKEN = "bill_name_taken"
    BILL_NOT_ALLOWED = "bill_not_allowed"
    # Recorrentes
    RECURRENCE_NOT_FOUND = "recurrence_not_found"
    RECURRENCE_INVALID = "recurrence_invalid"
    # Cofrinhos
    PIGGY_BANK_NOT_FOUND = "piggy_bank_not_found"
    PIGGY_BANK_NAME_TAKEN = "piggy_bank_name_taken"
    PIGGY_BANK_ACCOUNT_INVALID = "piggy_bank_account_invalid"
    PIGGY_BANK_NOT_ENOUGH_AVAILABLE = "piggy_bank_not_enough_available"
    PIGGY_BANK_NOT_ENOUGH_SAVED = "piggy_bank_not_enough_saved"
    # Contas e moedas
    ACCOUNT_NOT_FOUND = "account_not_found"
    ACCOUNT_NAME_TAKEN = "account_name_taken"
    ACCOUNT_HAS_TRANSACTIONS = "account_has_transactions"
    CURRENCY_NOT_FOUND = "currency_not_found"
    INVALID_AMOUNT = "invalid_amount"
    # Transacoes
    TRANSACTION_NOT_FOUND = "transaction_not_found"
    INVALID_SPLIT_ACCOUNTS = "invalid_split_accounts"
    CURRENCY_MISMATCH = "currency_mismatch"
    # Genericos
    VALIDATION_ERROR = "validation_error"
    RATE_LIMITED = "rate_limited"
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    FORBIDDEN = "forbidden"
    UNAUTHORIZED = "unauthorized"
    INTERNAL_ERROR = "internal_error"


class AppError(HTTPException):
    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        detail: str,
        headers: dict[str, str] | None = None,
    ):
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code


# Codigo padrao para erros que o proprio FastAPI/Starlette levanta (rota inexistente etc.)
_DEFAULT_CODES = {
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
}


def _error_response(
    status_code: int,
    code: str,
    detail: str,
    headers: dict[str, str] | None = None,
    **extra,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail, "code": str(code), **extra},
        headers=headers,
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = getattr(exc, "code", None) or _DEFAULT_CODES.get(exc.status_code, f"http_{exc.status_code}")
    return _error_response(exc.status_code, code, str(exc.detail), exc.headers)


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    # O erro padrao do FastAPI devolve o campo `input`, que repete o que o usuario enviou
    # (inclusive a senha digitada). Aqui so saem o nome do campo e a mensagem.
    errors = []
    for error in exc.errors():
        location = [str(part) for part in error["loc"] if part not in ("body", "query", "path")]
        message = str(error["msg"]).removeprefix("Value error, ")
        errors.append({"field": ".".join(location), "message": message})
    return _error_response(422, ErrorCode.VALIDATION_ERROR, "Dados invalidos", errors=errors)


async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return _error_response(
        429,
        ErrorCode.RATE_LIMITED,
        "Muitas requisicoes. Tente novamente em instantes.",
        headers={"Retry-After": "60"},
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # O detalhe real vai so para o log. A resposta nao pode vazar nada interno.
    logger.exception("Erro nao tratado em %s %s", request.method, request.url.path)
    return _error_response(500, ErrorCode.INTERNAL_ERROR, "Erro interno do servidor")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

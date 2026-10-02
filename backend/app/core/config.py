from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET = "change-me-in-env"
# Minimo recomendado para chave HMAC-SHA256 (RFC 7518)
MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    # Configuracoes lidas de variaveis de ambiente ou do arquivo .env
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "production" liga as checagens de seguranca da configuracao
    environment: str = "development"
    database_url: str = "postgresql+psycopg://finance:finance@localhost:5432/finance"
    jwt_secret: str = DEFAULT_SECRET
    jwt_algorithm: str = "HS256"
    # Cifra segredos guardados no banco (ex: credenciais do agregador de Open Finance).
    # Separada do jwt_secret para trocar uma sem afetar a outra.
    encryption_key: str = DEFAULT_SECRET
    access_token_expire_minutes: int = 60
    # Teto absoluto da sessao deslizante, em horas. 0 desliga o teto.
    session_max_hours: int = 168
    cors_origins: str = "http://localhost:5173"
    max_failed_login_attempts: int = 5
    account_lock_minutes: int = 15
    invite_expire_days: int = 7
    # Ligar so quando o backend roda atras de um proxy confiavel (Nginx, Caddy) que sempre
    # define X-Forwarded-For. Exposto direto na internet, qualquer cliente poderia forjar o
    # header e escapar do rate limit.
    trust_proxy_headers: bool = False
    # Ligado por padrao. So desligar em teste automatizado (E2E), que entra varias vezes por
    # minuto a partir do mesmo IP. Em uso real o limite protege o login de forca bruta.
    rate_limit_enabled: bool = True
    # Laco que cria os lancamentos das recorrentes. Desligado nos testes; em uso real fica ligado.
    recurrence_scheduler_enabled: bool = True
    recurrence_interval_seconds: int = 300
    # Intervalo do laco que entrega os webhooks pendentes (liga e desliga junto com o das recorrentes)
    webhook_interval_seconds: int = 30
    # Libera webhooks para IP privado, loopback e http. Por padrao so https para enderecos publicos,
    # para um webhook nao servir de ponte para a rede interna (SSRF). Ligar so em rede de confianca.
    webhook_allow_private: bool = False
    # Pasta dos anexos dos lancamentos (um volume em producao) e tamanho maximo de cada arquivo
    attachments_dir: str = "/data/attachments"
    attachment_max_bytes: int = 10 * 1024 * 1024
    # Fuso que define "hoje" para recorrentes, orcamentos e contas a pagar (nome do banco IANA)
    app_timezone: str = "America/Sao_Paulo"

    @model_validator(mode="after")
    def check_timezone(self):
        try:
            ZoneInfo(self.app_timezone)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(f"APP_TIMEZONE invalido: {self.app_timezone}") from error
        return self

    @model_validator(mode="after")
    def reject_default_secrets_in_production(self):
        # Subir em producao com o segredo de exemplo deixaria qualquer um forjar tokens
        if self.environment == "production":
            if DEFAULT_SECRET in (self.jwt_secret, self.encryption_key):
                raise ValueError(
                    "JWT_SECRET e ENCRYPTION_KEY precisam ser definidos em producao"
                )
            if min(len(self.jwt_secret), len(self.encryption_key)) < MIN_SECRET_LENGTH:
                raise ValueError(
                    f"JWT_SECRET e ENCRYPTION_KEY precisam ter pelo menos {MIN_SECRET_LENGTH} caracteres"
                )
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

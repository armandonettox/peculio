from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET = "change-me-in-env"


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

    @model_validator(mode="after")
    def reject_default_secrets_in_production(self):
        # Subir em producao com o segredo de exemplo deixaria qualquer um forjar tokens
        if self.environment == "production":
            if DEFAULT_SECRET in (self.jwt_secret, self.encryption_key):
                raise ValueError(
                    "JWT_SECRET e ENCRYPTION_KEY precisam ser definidos em producao"
                )
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

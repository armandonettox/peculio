import pytest
from pydantic import ValidationError

from app.core.config import DEFAULT_SECRET, Settings


def make_settings(**overrides) -> Settings:
    # _env_file=None ignora o .env da maquina para o teste ser reproduzivel
    return Settings(_env_file=None, **overrides)


def test_production_rejects_default_jwt_secret():
    with pytest.raises(ValidationError):
        make_settings(environment="production", jwt_secret=DEFAULT_SECRET, encryption_key="x" * 32)


def test_production_rejects_default_encryption_key():
    with pytest.raises(ValidationError):
        make_settings(environment="production", jwt_secret="x" * 32, encryption_key=DEFAULT_SECRET)


def test_production_accepts_real_secrets():
    settings = make_settings(
        environment="production", jwt_secret="a" * 32, encryption_key="b" * 32
    )
    assert settings.jwt_secret != DEFAULT_SECRET


def test_production_rejects_short_secrets():
    with pytest.raises(ValidationError):
        make_settings(environment="production", jwt_secret="curto", encryption_key="b" * 32)


def test_development_accepts_default_secrets():
    settings = make_settings(
        environment="development", jwt_secret=DEFAULT_SECRET, encryption_key=DEFAULT_SECRET
    )
    assert settings.jwt_secret == DEFAULT_SECRET


def test_cors_origins_list_splits_and_trims():
    settings = make_settings(cors_origins="http://a.com, http://b.com ,")
    assert settings.cors_origins_list == ["http://a.com", "http://b.com"]

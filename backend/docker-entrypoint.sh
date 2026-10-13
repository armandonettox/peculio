#!/bin/sh
set -e

# Aplica as migrations antes de subir a API. O banco pode ainda nao aceitar conexao (o compose
# so espera ele iniciar, nao ficar pronto), entao tenta de novo por ate 60 segundos.
tentativa=1
until alembic upgrade head; do
  if [ "$tentativa" -ge 30 ]; then
    echo "Migrations falharam depois de $tentativa tentativas" >&2
    exit 1
  fi
  tentativa=$((tentativa + 1))
  echo "Banco ainda nao respondeu, nova tentativa ($tentativa/30) em 2 s..."
  sleep 2
done

exec uvicorn app.main:app --host 0.0.0.0 --port 8000

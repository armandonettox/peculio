#!/bin/sh
set -e

# Aplica as migrations antes de subir a API
alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000

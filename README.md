# Pecúlio

Organizacao financeira pessoal, open source e self-hosted.

"Pecúlio" e o dinheiro que a pessoa junta e guarda para si. No codigo, nos pacotes e nas pastas o nome e escrito `peculio`, sem acento.

## Stack

- Backend: Python + FastAPI (API REST)
- Banco: PostgreSQL
- Frontend: React + Vite + TypeScript
- Execucao: Docker Compose
- Open Finance: via agregador (Pluggy ou Belvo, a definir)

## Como rodar

```bash
cp .env.example .env
# edite o .env e troque a senha do banco
docker compose up --build
```

O app fica em http://localhost:8080 e a API responde em `/api/health`.

## Desenvolvimento sem Docker

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
pytest
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Escopo da primeira versao

Contas, transacoes e categorias com CRUD. Orcamentos, Open Finance e relatorios vem depois.

## Licenca

AGPL-3.0. Veja o arquivo `LICENSE`.

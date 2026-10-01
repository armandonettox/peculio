"""Exporta o OpenAPI do FastAPI para frontend/openapi.json.

O frontend gera os tipos TypeScript a partir desse arquivo (npm run gen:api).
Rode depois de mudar qualquer endpoint ou schema:

    cd backend && python scripts/export_openapi.py
    cd ../frontend && npm run gen:api
"""

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

OUTPUT_PATH = BACKEND_DIR.parent / "frontend" / "openapi.json"


def build_openapi_json() -> str:
    from app.main import app

    # sort_keys deixa a saida estavel, senao o diff do git muda sem motivo
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> None:
    OUTPUT_PATH.write_text(build_openapi_json(), encoding="utf-8", newline="\n")
    print(f"OpenAPI exportado para {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

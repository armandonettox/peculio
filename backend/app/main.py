from fastapi import FastAPI

app = FastAPI(title="finance-app", version="0.1.0")


@app.get("/api/health")
def health() -> dict:
    # Usado pelo docker compose e pelo frontend para saber se a API esta no ar
    return {"status": "ok"}

"""Cria uma conta de demonstração com dados fictícios, para ver como cada tela fica.

Roda dentro do backend (precisa do banco) e usa a própria API, então os dados passam pelas mesmas
regras de um uso real. Nada aqui vem de dados reais: nomes, valores e datas são inventados e as datas
são calculadas a partir de "hoje".

    docker compose exec backend python scripts/seed_demo.py --confirm

Recusa rodar se a conta de demonstração já existir (não apaga nada). Para refazer, exclua o usuário
demo pela tela de administração ou direto no banco e rode de novo.
"""
import argparse
import random
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core import clock
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.main import app
from app.models.user import User

DEMO_EMAIL = "demo@example.com"
# Senha só desta conta de demonstração, que não guarda nada real
DEMO_PASSWORD = "demo-finance-2026"
MONTHS = 6

rng = random.Random(2026)


def month_day(today: date, months_back: int, day: int) -> date:
    """O dia `day` de `months_back` meses atrás (dias 29 a 31 viram 28, para existir em todo mês)."""
    total = today.year * 12 + today.month - 1 - months_back
    return date(total // 12, total % 12 + 1, min(day, 28))


def money(low: int, high: int) -> str:
    return f"{rng.randint(low * 100, high * 100) / 100:.2f}"


class Api:
    def __init__(self, client: TestClient, headers: dict):
        self.client = client
        self.headers = headers

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        response = self.client.request(method, f"/api/v1{path}", json=body, headers=self.headers)
        if response.status_code >= 300:
            raise SystemExit(f"{method} {path} falhou ({response.status_code}): {response.text}")
        return response.json() if response.content else {}

    def post(self, path: str, body: dict) -> dict:
        return self.call("POST", path, body)

    def patch(self, path: str, body: dict) -> dict:
        return self.call("PATCH", path, body)


def create_user() -> None:
    with SessionLocal() as db:
        if db.execute(select(User).where(User.email == DEMO_EMAIL)).scalar_one_or_none():
            raise SystemExit(f"O usuário {DEMO_EMAIL} já existe: nada foi feito.")
        db.add(User(name="Conta de demonstração", email=DEMO_EMAIL, hashed_password=hash_password(DEMO_PASSWORD)))
        db.commit()


def seed(api: Api, today: date) -> dict:
    first_day = month_day(today, MONTHS, 1)

    def account(name, role, balance, kind="asset", currency="BRL"):
        body = {
            "name": name,
            "type": kind,
            "role": role,
            "currency_code": currency,
            "opening_balance": balance,
            "opening_balance_date": first_day.isoformat(),
        }
        return api.post("/accounts", body)["id"]

    checking = account("Conta corrente", "checking", "3200.00")
    savings = account("Poupança", "savings", "9000.00")
    wallet = account("Carteira", "cash", "240.00")
    dollars = account("Conta em dólar", "other", "800.00", currency="USD")
    mortgage = account("Financiamento do apartamento", "mortgage", "38000.00", kind="liability")

    categories = {}
    for name, color in [
        ("Salário", "#00A878"),
        ("Moradia", "#1E3A6B"),
        ("Mercado", "#E8A33D"),
        ("Transporte", "#5B8DEF"),
        ("Lazer", "#B565D9"),
        ("Saúde", "#E5534B"),
        ("Assinaturas", "#2A9D8F"),
    ]:
        categories[name] = api.post("/categories", {"name": name, "color": color})["id"]
    tags = {name: api.post("/tags", {"name": name})["id"] for name in ["viagem", "trabalho", "fixo"]}

    budgets = {
        "Mercado": api.post(
            "/budgets", {"name": "Mercado", "currency_code": "BRL", "amount": "1100.00", "period": "monthly"}
        )["id"],
        "Lazer": api.post(
            "/budgets", {"name": "Lazer", "currency_code": "BRL", "amount": "350.00", "period": "monthly"}
        )["id"],
    }

    # Contas a pagar antes dos lançamentos: o que combina com o texto liga sozinho
    def bill(name, low, high, match, first, frequency="monthly"):
        body = {
            "name": name,
            "currency_code": "BRL",
            "amount_min": low,
            "amount_max": high,
            "match_text": match,
            "first_due_date": first.isoformat(),
            "frequency": frequency,
        }
        return api.post("/bills", body)["id"]

    bill("Aluguel", "1800.00", "1900.00", "aluguel", month_day(today, MONTHS, 8))
    bill("Internet", "110.00", "130.00", "internet", month_day(today, MONTHS, 12))
    bill("Streaming", "50.00", "60.00", "streaming", month_day(today, MONTHS, 15))
    # Sem nenhum pagamento: mostra vários vencimentos seguidos atrasados
    bill("Seguro do carro", "290.00", "320.00", None, month_day(today, 3, 20))
    bill("IPTU", "900.00", "1000.00", None, month_day(today, 0, 28) + timedelta(days=60), "yearly")

    def tx(day, description, amount, account_id, kind="withdrawal", **extra):
        if day > today:
            return
        split = {
            "type": kind,
            "date": day.isoformat(),
            "description": description,
            "amount": amount,
            "currency_code": "BRL",
            "account_id": account_id,
            **extra,
        }
        api.post("/transactions", {"splits": [split]})

    shops = ["Supermercado Bom Preço", "Mercadinho da Esquina", "Hortifruti Verde", "Atacado Central"]
    for back in range(MONTHS, -1, -1):
        m = lambda d: month_day(today, back, d)  # noqa: E731
        tx(m(5), "Salário", "6800.00", checking, "deposit", counterparty_name="Empresa Exemplo",
           category_id=categories["Salário"], tag_ids=[tags["trabalho"]])
        tx(m(6), "Reserva do mês", "600.00", checking, "transfer", counterparty_account_id=savings)
        tx(m(8), "Aluguel", "1850.00", checking, counterparty_name="Imobiliária Central",
           category_id=categories["Moradia"], tag_ids=[tags["fixo"]])
        tx(m(10), "Parcela do financiamento", "1200.00", checking, "transfer", counterparty_account_id=mortgage)
        tx(m(12), "Internet fibra", "119.90", checking, counterparty_name="Provedor Exemplo",
           category_id=categories["Moradia"], tag_ids=[tags["fixo"]])
        tx(m(15), "Streaming", "55.90", checking, counterparty_name="Streaming Exemplo",
           category_id=categories["Assinaturas"], tag_ids=[tags["fixo"]])
        for week, shop in enumerate(shops):
            tx(m(3 + week * 7), f"Compras no {shop}", money(90, 280), checking, counterparty_name=shop,
               category_id=categories["Mercado"], budget_id=budgets["Mercado"])
        for day in (4, 11, 18, 25):
            tx(m(day), "Corrida de aplicativo", money(18, 55), wallet if day % 2 else checking,
               counterparty_name="Transporte Exemplo", category_id=categories["Transporte"])
        for day, place in ((13, "Cinema"), (21, "Restaurante"), (27, "Show")):
            tx(m(day), place, money(45, 160), checking, counterparty_name=f"{place} Exemplo",
               category_id=categories["Lazer"], budget_id=budgets["Lazer"])
        tx(m(17), "Farmácia", money(60, 210), checking, counterparty_name="Farmácia Exemplo",
           category_id=categories["Saúde"])

    # Compra paga em reais com o valor original em dólar (só informativo)
    tx(month_day(today, 2, 18), "Assinatura de software", "95.00", checking, counterparty_name="Software Exemplo",
       foreign_amount="18.00", foreign_currency_code="USD", category_id=categories["Assinaturas"])
    # Uma compra dividida em duas linhas
    api.post("/transactions", {
        "title": "Compras de sábado",
        "splits": [
            {"type": "withdrawal", "date": (today - timedelta(days=9)).isoformat(), "description": "Mercado",
             "amount": "210.00", "currency_code": "BRL", "account_id": checking,
             "counterparty_name": "Supermercado Bom Preço", "category_id": categories["Mercado"]},
            {"type": "withdrawal", "date": (today - timedelta(days=9)).isoformat(), "description": "Farmácia",
             "amount": "64.50", "currency_code": "BRL", "account_id": checking,
             "counterparty_name": "Supermercado Bom Preço", "category_id": categories["Saúde"]},
        ],
    })
    # Viagem paga em dólar na conta em dólar
    api.post("/transactions", {"splits": [{
        "type": "withdrawal", "date": (today - timedelta(days=40)).isoformat(), "description": "Hotel em Orlando",
        "amount": "310.00", "currency_code": "USD", "account_id": dollars, "counterparty_name": "Hotel Exemplo",
        "tag_ids": [tags["viagem"]]}]})

    # Cofrinhos: um em andamento, um perto da meta e um arquivado (o valor continua reservado)
    trip = api.post("/piggy-banks", {"name": "Viagem de férias", "account_id": savings, "target_amount": "6000.00",
                                     "target_date": month_day(today, -8, 15).isoformat()})["id"]
    reserve = api.post("/piggy-banks", {"name": "Reserva de emergência", "account_id": savings,
                                        "target_amount": "10000.00"})["id"]
    old = api.post("/piggy-banks", {"name": "Notebook novo", "account_id": savings, "target_amount": "4500.00"})["id"]
    for piggy, amount, back in [(trip, "1200.00", 3), (trip, "800.00", 1), (reserve, "4200.00", 4),
                                (reserve, "5000.00", 1), (old, "900.00", 5)]:
        api.post(f"/piggy-banks/{piggy}/events", {"kind": "add", "amount": amount,
                                                  "date": month_day(today, back, 9).isoformat()})
    api.patch(f"/piggy-banks/{old}", {"active": False})

    # Recorrentes: as datas começam no futuro, para o app não criar lançamentos atrasados na hora
    def recurrence(name, first, description, amount, account_id, kind="withdrawal", **extra):
        split = {"type": kind, "date": first.isoformat(), "description": description, "amount": amount,
                 "currency_code": "BRL", "account_id": account_id, **extra}
        return api.post("/recurrences", {"name": name, "frequency": "monthly", "first_date": first.isoformat(),
                                         "template": {"splits": [split]}})["id"]

    soon = month_day(today, -1, 5)
    recurrence("Salário mensal", soon, "Salário", "6800.00", checking, "deposit",
               counterparty_name="Empresa Exemplo", category_id=categories["Salário"])
    recurrence("Música", month_day(today, -1, 20), "Assinatura de música", "21.90", checking,
               counterparty_name="Música Exemplo", category_id=categories["Assinaturas"])
    paused = recurrence("Academia", month_day(today, -1, 3), "Mensalidade da academia", "99.00", checking,
                        counterparty_name="Academia Exemplo", category_id=categories["Saúde"])
    api.patch(f"/recurrences/{paused}", {"active": False})

    # Envelopes do mês atual: um com sobra, um estourado (para mostrar "Cobrir") e a reserva que veio do mês passado
    this_month = today.strftime("%Y-%m")
    last_month = month_day(today, 1, 1).strftime("%Y-%m")
    envelopes = {}
    for name in ("Moradia fixa", "Alimentação", "Reserva do mês"):
        envelopes[name] = api.post("/budgets", {"name": name, "currency_code": "BRL", "mode": "envelope"})["id"]
    for name, month, amount in [
        ("Moradia fixa", this_month, "1900.00"),
        ("Alimentação", this_month, "700.00"),
        ("Reserva do mês", last_month, "300.00"),
        ("Reserva do mês", this_month, "200.00"),
    ]:
        api.call("PUT", f"/envelopes/{envelopes[name]}/{month}", {"amount": amount})
    tx(today, "Aluguel do mês", "1850.00", checking, counterparty_name="Imobiliária Central", budget_id=envelopes["Moradia fixa"])
    tx(today, "Compras grandes do mês", "820.00", checking, counterparty_name="Atacado Central", budget_id=envelopes["Alimentação"])

    # Regra: preenche a categoria de lançamentos novos que citam mercado
    api.post("/rules", {"name": "Mercado na categoria", "match_mode": "all",
                        "triggers": [{"field": "description", "op": "contains", "value": "mercado"}],
                        "actions": [{"kind": "set_category", "target_id": categories["Mercado"]}]})
    return {"accounts": 5, "categories": len(categories), "budgets": len(budgets)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--confirm", action="store_true", help="confirma que quer criar a conta de demonstração")
    if not parser.parse_args().confirm:
        raise SystemExit("Nada foi feito. Rode de novo com --confirm para criar a conta de demonstração.")

    create_user()
    client = TestClient(app)
    login = client.post("/api/v1/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    if login.status_code != 200:
        raise SystemExit(f"Login da conta de demonstração falhou ({login.status_code}): {login.text}")
    api = Api(client, {"Authorization": f"Bearer {login.json()['access_token']}"})
    summary = seed(api, clock.today())
    print(f"Conta de demonstração pronta: {DEMO_EMAIL} (senha no topo de scripts/seed_demo.py)")
    print(summary)


if __name__ == "__main__":
    main()

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models.bill import Bill
from app.models.budget import BudgetTemplate, TemplateKind
from app.models.currency import Currency
from app.models.user import User
from app.schemas.envelope import parse_month
from app.schemas.template import TemplateIn
from app.services import envelope_calc as calc
from app.services import envelopes
from app.services import template_calc as tcalc
from app.services.accounts import check_amount, get_currency
from app.services.bills import get_owned_bill

ZERO = Decimal("0")


# ---------- Definir ----------


def get_template(db: Session, budget_id: uuid.UUID) -> BudgetTemplate | None:
    return db.execute(select(BudgetTemplate).where(BudgetTemplate.budget_id == budget_id)).scalar_one_or_none()


def set_template(db: Session, user: User, budget_id: uuid.UUID, data: TemplateIn) -> BudgetTemplate:
    """Cria ou troca o template do envelope. Troca por inteiro: nada do tipo anterior sobra."""
    budget = envelopes._owned_envelope(db, user.id, budget_id, lock=True)
    if data.amount is not None:
        check_amount(get_currency(db, budget.currency_code), data.amount)
    if data.bill_id is not None:
        bill = get_owned_bill(db, user.id, data.bill_id)
        if bill.currency_code != budget.currency_code:
            raise AppError(400, ErrorCode.CURRENCY_MISMATCH, "A conta a pagar e o envelope precisam estar na mesma moeda")
    template = get_template(db, budget.id)
    if template is None:
        template = BudgetTemplate(user_id=user.id, budget_id=budget.id)
        db.add(template)
    template.kind = data.kind
    template.amount = data.amount
    template.target_month = parse_month(data.target_month) if data.target_month else None
    template.bill_id = data.bill_id
    db.flush()
    return template


def remove_template(db: Session, user: User, budget_id: uuid.UUID) -> None:
    budget = envelopes._owned_envelope(db, user.id, budget_id, lock=True)
    template = get_template(db, budget.id)
    if template is None:
        raise AppError(404, ErrorCode.TEMPLATE_NOT_FOUND, "Este envelope nao tem template")
    db.delete(template)
    db.flush()


# ---------- Quanto cada template pede ----------


def _wanted(template: BudgetTemplate, bill: Bill | None, month: date, carried: Decimal, places: int) -> tuple[Decimal, str | None]:
    """O que o template pede para o mes e, quando pede zero, o porque. O tipo "remainder" nao sai daqui."""
    if template.kind == TemplateKind.fixed:
        return template.amount, None
    if template.kind == TemplateKind.by_date:
        value = tcalc.by_date_amount(template.amount, template.target_month, month, carried, places)
        if value > ZERO:
            return value, None
        return ZERO, "date_passed" if tcalc.months_left(month, template.target_month) == 0 and template.amount > carried else "goal_met"
    if template.kind == TemplateKind.bill:
        value = tcalc.bill_amount(bill.amount_max, bill.first_due_date, bill.frequency, month) if bill else ZERO
        return value, None if value > ZERO else "no_due_date"
    return ZERO, None


def _context(db: Session, user: User, month: date) -> tuple[dict, dict, dict, dict]:
    view = envelopes.month_view(db, user, month)
    ids = [item["budget_id"] for group in view["groups"] for item in group["envelopes"]]
    templates = {}
    if ids:
        templates = {
            row.budget_id: row
            for row in db.execute(select(BudgetTemplate).where(BudgetTemplate.budget_id.in_(ids))).scalars()
        }
    bill_ids = [row.bill_id for row in templates.values() if row.bill_id is not None]
    bills = {}
    if bill_ids:
        bills = {bill.id: bill for bill in db.execute(select(Bill).where(Bill.id.in_(bill_ids))).scalars()}
    codes = {group["currency_code"] for group in view["groups"]}
    places = dict(db.execute(select(Currency.code, Currency.decimal_places).where(Currency.code.in_(codes))).all()) if codes else {}
    return view, templates, bills, places


# ---------- O mes com templates e selo de meta ----------


def month_with_templates(db: Session, user: User, month: date) -> dict:
    """O mes dos envelopes (como em `envelopes.month_view`) com o template e o selo de meta de cada um."""
    view, templates, bills, places = _context(db, user, month)
    for group in view["groups"]:
        decimals = places[group["currency_code"]]
        for item in group["envelopes"]:
            template = templates.get(item["budget_id"])
            item["template"] = template
            item["goal"] = None
            if template is None or template.kind == TemplateKind.remainder:
                continue
            wanted, reason = _wanted(template, bills.get(template.bill_id), month, item["carried"], decimals)
            if wanted > ZERO:
                item["goal"] = tcalc.goal_state(item["allocated"], wanted)
            elif reason == "goal_met":
                item["goal"] = "met"
    return view


# ---------- Previa e aplicar ----------


def preview(db: Session, user: User, month: date, overwrite: bool) -> dict:
    """O que aplicar os templates faria neste mes, sem gravar nada. Sem `overwrite`, so os envelopes sem valor."""
    view, templates, bills, places = _context(db, user, month)
    groups = []
    for group in view["groups"]:
        decimals = places[group["currency_code"]]
        rows = []
        # Disponivel de cada envelope depois da aplicacao, para recalcular o "A orcar"
        available = {item["budget_id"]: item["available"] for item in group["envelopes"]}
        remainder_rows = []

        for item in group["envelopes"]:
            template = templates.get(item["budget_id"])
            if template is None:
                continue
            current = item["allocated"]
            row = {
                "budget_id": item["budget_id"], "name": item["name"], "kind": template.kind,
                "current": current, "wanted": ZERO, "proposed": current, "applies": False, "reason": None,
            }
            eligible = overwrite or current == ZERO
            if template.kind == TemplateKind.remainder:
                if eligible:
                    # Sai do que ja tinha: o rateio recalcula este envelope do zero
                    available[item["budget_id"]] = item["available"] - current
                    remainder_rows.append(row)
                else:
                    row["reason"] = "already_has"
                rows.append(row)
                continue
            wanted, why = _wanted(template, bills.get(template.bill_id), month, item["carried"], decimals)
            row["wanted"] = wanted
            if not eligible:
                row["reason"] = "already_has"
            elif wanted <= ZERO:
                row["reason"] = why
            else:
                row["applies"], row["proposed"] = True, wanted
                available[item["budget_id"]] = item["available"] - current + wanted
            rows.append(row)

        def to_budget() -> Decimal:
            return group["money"] - sum((max(value, ZERO) for value in available.values()), ZERO)

        left = to_budget()
        share = tcalc.split_remainder(left, len(remainder_rows), decimals)
        for row in remainder_rows:
            row["wanted"] = share
            if share > ZERO:
                row["applies"], row["proposed"] = True, share
                item = next(i for i in group["envelopes"] if i["budget_id"] == row["budget_id"])
                available[row["budget_id"]] = item["available"] - item["allocated"] + share
            else:
                row["reason"] = "no_money_left"
                # Fica como estava: volta o que foi tirado do calculo
                item = next(i for i in group["envelopes"] if i["budget_id"] == row["budget_id"])
                available[row["budget_id"]] = item["available"]

        groups.append(
            {
                "currency_code": group["currency_code"],
                "to_budget_before": group["to_budget"],
                "to_budget_after": to_budget(),
                "rows": rows,
            }
        )
    return {"month": month, "overwrite": overwrite, "groups": groups}


def apply(db: Session, user: User, month: date, overwrite: bool) -> None:
    result = preview(db, user, month, overwrite)
    changes = [row for group in result["groups"] for row in group["rows"] if row["applies"]]
    # Trava na mesma ordem sempre: duas aplicacoes juntas nao se travam uma a outra
    for row in sorted(changes, key=lambda item: str(item["budget_id"])):
        envelopes._owned_envelope(db, user.id, row["budget_id"], lock=True)
    for row in changes:
        envelopes._apply(db, user.id, row["budget_id"], month, row["proposed"])

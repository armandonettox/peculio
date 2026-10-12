import calendar
import logging
import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate
from app.models.currency import Currency
from app.models.recurrence import Recurrence, RecurrenceFrequency
from app.models.transaction import TransactionSplit, TransactionType
from app.models.user import User
from app.schemas.recurrence import RecurrenceCreate, RecurrenceUpdate
from app.schemas.transaction import TransactionCreate
from app.services.accounts import check_amount, get_currency, quantize_money

logger = logging.getLogger("peculio.recurrences")

# Por rodada e por recorrente: uma diaria parada por anos nao trava o laco; o resto sai na proxima
MAX_PER_RUN = 500

# ---------- Datas (funcoes puras) ----------

MONTH_STEP = {
    RecurrenceFrequency.monthly: 1,
    RecurrenceFrequency.quarterly: 3,
    RecurrenceFrequency.half_yearly: 6,
    RecurrenceFrequency.yearly: 12,
}


def occurrence(first: date, frequency: RecurrenceFrequency, index: int) -> date:
    """A data da ocorrencia de numero `index` (0 = a primeira). Conta sempre a partir da primeira,
    entao uma recorrente do dia 31 cai no ultimo dia dos meses curtos e volta ao 31 quando o mes tem."""
    if frequency == RecurrenceFrequency.daily:
        return first + timedelta(days=index)
    if frequency == RecurrenceFrequency.weekly:
        return first + timedelta(days=7 * index)
    total = first.month - 1 + MONTH_STEP[frequency] * index
    year, month = first.year + total // 12, total % 12 + 1
    return date(year, month, min(first.day, calendar.monthrange(year, month)[1]))


def latest_index(first: date, frequency: RecurrenceFrequency, on: date) -> int | None:
    """Numero da ultima ocorrencia que ja chegou (<= on), ou None se a primeira ainda esta no futuro."""
    if on < first:
        return None
    if frequency == RecurrenceFrequency.daily:
        return (on - first).days
    if frequency == RecurrenceFrequency.weekly:
        return (on - first).days // 7
    months = (on.year - first.year) * 12 + (on.month - first.month)
    index = months // MONTH_STEP[frequency]
    # O mes da ocorrencia pode ser o de `on` e o dia ainda nao ter chegado
    while occurrence(first, frequency, index) > on:
        index -= 1
    return index


def _midpoint(start: date, end: date) -> date:
    return start + timedelta(days=(end - start).days // 2)


def window(first: date, frequency: RecurrenceFrequency, index: int) -> tuple[date | None, date]:
    """Datas de pagamento que quitam o vencimento `index`: do ponto medio com o vencimento anterior
    (exclusivo) ate o ponto medio com o seguinte (inclusivo). Cada pagamento cai em um so vencimento,
    o mais proximo dele, e pagar um pouco antes ou depois continua valendo."""
    due = occurrence(first, frequency, index)
    low = None if index == 0 else _midpoint(occurrence(first, frequency, index - 1), due)
    high = _midpoint(due, occurrence(first, frequency, index + 1))
    return low, high


def _paid(payments: Sequence[date], low: date | None, high: date) -> bool:
    return any((low is None or day > low) and day <= high for day in payments)


def _overdue_run(first: date, frequency: RecurrenceFrequency, payments: Sequence[date], last_index: int) -> tuple[int, date]:
    """Quantos vencimentos seguidos, ate o de numero `last_index` (que esta sem pagamento), ficaram sem pagar,
    e a data do mais antigo deles. Para no primeiro pago ou no primeiro vencimento da recorrente."""
    count, index = 0, last_index
    while index >= 0:
        low, high = window(first, frequency, index)
        if _paid(payments, low, high):
            break
        count += 1
        index -= 1
    return count, occurrence(first, frequency, last_index - count + 1)


def _next_after(recurrence: Recurrence, index: int) -> date | None:
    """Data da ocorrencia `index`, ou None se a recorrente ja terminou antes dela (ou nao e automatica)."""
    if not recurrence.auto_create:
        return None
    if recurrence.max_occurrences is not None and index >= recurrence.max_occurrences:
        return None
    day = occurrence(recurrence.first_date, recurrence.frequency, index)
    if recurrence.end_date is not None and day > recurrence.end_date:
        return None
    return day


def upcoming_date(recurrence: Recurrence) -> date | None:
    """Data da proxima ocorrencia que ainda vai ser criada, ou None se esta pausada, ja terminou,
    ou nao e do modo automatico."""
    if not recurrence.active:
        return None
    return _next_after(recurrence, recurrence.next_index)


# ---------- Acesso e CRUD ----------


def get_owned_recurrence(db: Session, user_id: uuid.UUID, recurrence_id: uuid.UUID) -> Recurrence:
    """404 tambem quando e de outro usuario, para nao revelar que existe."""
    recurrence = db.execute(
        select(Recurrence).where(Recurrence.id == recurrence_id, Recurrence.user_id == user_id)
    ).scalar_one_or_none()
    if not recurrence:
        raise AppError(404, ErrorCode.RECURRENCE_NOT_FOUND, "Recorrente nao encontrada")
    return recurrence


def get_owned_bill_mode_recurrence(db: Session, user_id: uuid.UUID, recurrence_id: uuid.UUID) -> Recurrence:
    """Para ligar um lancamento: so vale uma recorrente do modo de lembrete (sem auto_create). Uma
    recorrente automatica nao pode ser escolhida aqui, pelo mesmo motivo de nao revelar que existe:
    404 generico, nao "nao permitido"."""
    recurrence = db.execute(
        select(Recurrence).where(Recurrence.id == recurrence_id, Recurrence.user_id == user_id, Recurrence.auto_create.is_(False))
    ).scalar_one_or_none()
    if not recurrence:
        raise AppError(404, ErrorCode.BILL_NOT_FOUND, "Conta a pagar nao encontrada")
    return recurrence


def _save(db: Session, recurrence: Recurrence) -> None:
    # A unicidade e do banco (indice em lower(nome), so para o modo de lembrete): vale mesmo com duas requisicoes juntas
    try:
        with db.begin_nested():
            db.add(recurrence)
            db.flush()
    except IntegrityError:
        raise AppError(409, ErrorCode.BILL_NAME_TAKEN, "Ja existe uma recorrente com esse nome")


def _check_range(currency: Currency, amount_min: Decimal, amount_max: Decimal) -> None:
    check_amount(currency, amount_min)
    check_amount(currency, amount_max)
    if amount_max < amount_min:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "O valor maximo nao pode ser menor que o minimo")


def _at(template: TransactionCreate, day: date) -> TransactionCreate:
    """O modelo com a data de cada linha trocada por `day`."""
    return template.model_copy(update={"splits": [split.model_copy(update={"date": day}) for split in template.splits]})


def _dump(template: TransactionCreate) -> dict:
    # exclude_unset: um bill_id ausente (liga sozinho) continua diferente de um bill_id null (nao liga)
    return template.model_dump(mode="json", exclude_unset=True)


def _check_template(db: Session, user: User, template: TransactionCreate, day: date) -> None:
    """Confere o modelo com as mesmas regras de um lancamento de verdade, sem gravar nada."""
    from app.services.transactions import create_transaction  # import tardio: evita ciclo com transactions.py

    savepoint = db.begin_nested()
    try:
        create_transaction(db, user, _at(template, day))
    finally:
        savepoint.rollback()


def create_recurrence(db: Session, user: User, data: RecurrenceCreate) -> Recurrence:
    if data.auto_create:
        _check_template(db, user, data.template, data.first_date)
        currency_code = None
    else:
        currency = get_currency(db, data.currency_code)
        _check_range(currency, data.amount_min, data.amount_max)
        currency_code = currency.code

    recurrence = Recurrence(
        user_id=user.id,
        name=data.name,
        frequency=data.frequency,
        first_date=data.first_date,
        end_date=data.end_date,
        max_occurrences=data.max_occurrences,
        auto_create=data.auto_create,
        template=_dump(data.template) if data.auto_create else None,
        next_index=0,
        currency_code=currency_code,
        amount_min=data.amount_min,
        amount_max=data.amount_max,
        match_text=data.match_text,
    )
    recurrence.next_date = _next_after(recurrence, 0)
    _save(db, recurrence)
    return recurrence


def update_recurrence(db: Session, user: User, recurrence: Recurrence, data: RecurrenceUpdate, today: date) -> Recurrence:
    sent = data.model_fields_set
    if data.name is not None:
        recurrence.name = data.name
    if data.frequency is not None or data.first_date is not None:
        if recurrence.auto_create:
            raise AppError(400, ErrorCode.BILL_NOT_ALLOWED, "A frequencia e a primeira data nao mudam depois de criada")
        if data.frequency is not None:
            recurrence.frequency = data.frequency
        if data.first_date is not None:
            recurrence.first_date = data.first_date
    if data.template is not None:
        if not recurrence.auto_create:
            raise AppError(400, ErrorCode.BILL_NOT_ALLOWED, "Esta recorrente nao cria o lancamento sozinha")
        _check_template(db, user, data.template, recurrence.next_date or recurrence.first_date)
        recurrence.template = _dump(data.template)
    if not recurrence.auto_create:
        new_min = data.amount_min if data.amount_min is not None else recurrence.amount_min
        new_max = data.amount_max if data.amount_max is not None else recurrence.amount_max
        if data.amount_min is not None or data.amount_max is not None:
            _check_range(get_currency(db, recurrence.currency_code), new_min, new_max)
        recurrence.amount_min, recurrence.amount_max = new_min, new_max
        if "match_text" in sent:
            recurrence.match_text = data.match_text
    elif data.amount_min is not None or data.amount_max is not None or "match_text" in sent:
        raise AppError(400, ErrorCode.BILL_NOT_ALLOWED, "Esta recorrente cria o lancamento sozinha")
    # null explicito tira o fim; enviar um dos dois troca a regra de fim (so uma vale por vez)
    if "end_date" in sent or "max_occurrences" in sent:
        recurrence.end_date = data.end_date
        recurrence.max_occurrences = data.max_occurrences
        if recurrence.end_date is not None and recurrence.end_date < recurrence.first_date:
            raise AppError(422, ErrorCode.RECURRENCE_INVALID, "A data final nao pode ser antes da primeira")
        if recurrence.max_occurrences is not None and recurrence.end_date is not None:
            raise AppError(422, ErrorCode.RECURRENCE_INVALID, "Informe so a data final ou so o numero de repeticoes")
        recurrence.next_date = _next_after(recurrence, recurrence.next_index)
    if data.active is not None and data.active != recurrence.active:
        recurrence.active = data.active
        if data.active:
            _skip_missed(recurrence, today)
    _save(db, recurrence)
    return recurrence


def _skip_missed(recurrence: Recurrence, today: date) -> None:
    """Ao retomar, o periodo pausado nao e recuperado: pausar quer dizer nao criar. Pula para a
    primeira ocorrencia que ainda nao chegou. So vale no modo automatico."""
    if not recurrence.auto_create:
        return
    index = latest_index(recurrence.first_date, recurrence.frequency, today)
    if index is not None and index + 1 > recurrence.next_index:
        recurrence.next_index = index + 1
        recurrence.next_date = _next_after(recurrence, recurrence.next_index)
    recurrence.last_error = None


def delete_recurrence(db: Session, recurrence: Recurrence) -> None:
    # Os lancamentos ligados (criados ou so marcados) ficam (ON DELETE SET NULL no banco)
    db.delete(recurrence)
    db.flush()


def _places(db: Session, codes: set[str]) -> dict[str, int]:
    codes.discard(None)
    if not codes:
        return {}
    return dict(db.execute(select(Currency.code, Currency.decimal_places).where(Currency.code.in_(codes))).all())


def recurrence_output(recurrence: Recurrence, places: int | None) -> dict:
    return {
        "id": recurrence.id,
        "name": recurrence.name,
        "frequency": recurrence.frequency,
        "first_date": recurrence.first_date,
        "end_date": recurrence.end_date,
        "max_occurrences": recurrence.max_occurrences,
        "active": recurrence.active,
        "auto_create": recurrence.auto_create,
        "template": recurrence.template,
        "currency_code": recurrence.currency_code,
        "amount_min": None if recurrence.amount_min is None else quantize_money(recurrence.amount_min, places),
        "amount_max": None if recurrence.amount_max is None else quantize_money(recurrence.amount_max, places),
        "match_text": recurrence.match_text,
        "created_count": recurrence.next_index,
        "next_date": recurrence.next_date,
        "ended": recurrence.auto_create and recurrence.next_date is None,
        "last_error": recurrence.last_error,
        "created_at": recurrence.created_at,
    }


def build_outputs(db: Session, recurrences: Sequence[Recurrence]) -> list[dict]:
    places = _places(db, {recurrence.currency_code for recurrence in recurrences})
    return [recurrence_output(recurrence, places.get(recurrence.currency_code)) for recurrence in recurrences]


def to_output(db: Session, recurrence: Recurrence) -> dict:
    places = None
    if recurrence.currency_code:
        places = db.execute(
            select(Currency.decimal_places).where(Currency.code == recurrence.currency_code)
        ).scalar_one_or_none()
    return recurrence_output(recurrence, places)


def list_recurrences(db: Session, user_id: uuid.UUID, params: PageParams, q: str | None, active: bool | None) -> dict:
    statement = select(Recurrence).where(Recurrence.user_id == user_id)
    if active is not None:
        statement = statement.where(Recurrence.active == active)
    if q and q.strip():
        statement = statement.where(func.lower(Recurrence.name).contains(q.strip().lower(), autoescape=True))
    # Quem esta perto de disparar primeiro; as terminadas ou sem data (modo de lembrete) por ultimo
    page = paginate(
        db,
        statement.order_by(Recurrence.next_date.asc().nulls_last(), func.lower(Recurrence.name), Recurrence.id),
        params,
    )
    page["items"] = build_outputs(db, page["items"])
    return page


# ---------- Situacao dos vencimentos (modo de lembrete) ----------


def status(db: Session, user_id: uuid.UUID, on: date, include_archived: bool) -> list[dict]:
    """Cada recorrente do modo de lembrete com o ultimo e o proximo vencimento e se o ultimo foi
    pago, ordenadas pelo proximo vencimento. Uma consulta busca os pagamentos de todas elas."""
    statement = select(Recurrence).where(Recurrence.user_id == user_id, Recurrence.auto_create.is_(False))
    if not include_archived:
        statement = statement.where(Recurrence.active.is_(True))
    items_db = list(db.execute(statement).scalars())
    if not items_db:
        return []

    indexes = {item.id: latest_index(item.first_date, item.frequency, on) for item in items_db}
    payments: dict[uuid.UUID, list[date]] = defaultdict(list)
    rows = db.execute(
        select(TransactionSplit.bill_id, TransactionSplit.date).where(
            TransactionSplit.user_id == user_id,
            TransactionSplit.bill_id.in_([item.id for item in items_db]),
            TransactionSplit.type == TransactionType.withdrawal,
        )
    ).all()
    for bill_id, day in rows:
        payments[bill_id].append(day)

    places = _places(db, {item.currency_code for item in items_db})
    results = []
    for item in items_db:
        index = indexes[item.id]
        next_index = 0 if index is None else index + 1
        next_due = occurrence(item.first_date, item.frequency, next_index)
        low_next, high_next = window(item.first_date, item.frequency, next_index)
        overdue_count, oldest_overdue = 0, None
        if index is None:
            last_due, state = None, "upcoming"
        else:
            last_due = occurrence(item.first_date, item.frequency, index)
            low, high = window(item.first_date, item.frequency, index)
            if _paid(payments[item.id], low, high):
                state = "paid"
            else:
                state = "overdue"
                overdue_count, oldest_overdue = _overdue_run(item.first_date, item.frequency, payments[item.id], index)
        results.append(
            {
                **recurrence_output(item, places[item.currency_code]),
                "last_due_date": last_due,
                "next_due_date": next_due,
                "status": state,
                "overdue_count": overdue_count,
                "oldest_overdue_date": oldest_overdue,
                "next_due_paid": _paid(payments[item.id], low_next, high_next),
            }
        )
    results.sort(key=lambda item: (item["next_due_date"], item["name"].lower(), str(item["id"])))
    return results


# ---------- Ligacao automatica (modo de lembrete) ----------


def find_matching_recurrence(
    db: Session, user_id: uuid.UUID, currency_code: str, amount: Decimal, texts: Sequence[str]
) -> Recurrence | None:
    """A recorrente do modo de lembrete que combina com a saida, ou None. So liga se exatamente UMA
    combinar: com duas candidatas o app nao chuta, e a pessoa escolhe. Combina quem esta ativa, na
    mesma moeda, com o valor dentro da faixa e o texto presente em alguma das `texts`."""
    candidates = (
        db.execute(
            select(Recurrence).where(
                Recurrence.user_id == user_id,
                Recurrence.auto_create.is_(False),
                Recurrence.active.is_(True),
                Recurrence.currency_code == currency_code,
                Recurrence.match_text.is_not(None),
                Recurrence.amount_min <= amount,
                Recurrence.amount_max >= amount,
            )
        )
        .scalars()
        .all()
    )
    haystacks = [text.lower() for text in texts]
    found = [item for item in candidates if any(item.match_text.lower() in text for text in haystacks)]
    return found[0] if len(found) == 1 else None


# ---------- Criar os lancamentos que faltam (modo automatico) ----------


def process_recurrence(db: Session, recurrence: Recurrence, today: date) -> int:
    """Cria, em ordem, os lancamentos que ja deviam existir ate `today`. Devolve quantos criou.

    Cada ocorrencia e criada e contada na mesma transacao; se uma falhar, a recorrente para ali e guarda
    o motivo, e tenta de novo na proxima rodada, sem pular nenhuma data."""
    from app.services.transactions import create_transaction  # import tardio: evita ciclo com transactions.py

    if not recurrence.active or not recurrence.auto_create:
        return 0
    user = db.get(User, recurrence.user_id)
    created = 0
    while recurrence.next_date is not None and recurrence.next_date <= today and created < MAX_PER_RUN:
        day = recurrence.next_date
        savepoint = db.begin_nested()
        try:
            # A ligacao com a recorrente entra na criacao, para o evento do webhook ja sair com ela
            create_transaction(
                db,
                user,
                _at(TransactionCreate.model_validate(recurrence.template), day),
                recurrence_id=recurrence.id,
                recurrence_date=day,
            )
            savepoint.commit()
        except AppError as error:
            savepoint.rollback()
            recurrence.last_error = str(error.detail)
            break
        recurrence.next_index += 1
        recurrence.next_date = _next_after(recurrence, recurrence.next_index)
        recurrence.last_error = None
        created += 1
    return created


def run_for_user(db: Session, user: User, today: date) -> int:
    ids = db.execute(
        select(Recurrence.id).where(
            Recurrence.user_id == user.id, Recurrence.auto_create.is_(True), Recurrence.active.is_(True), Recurrence.next_date <= today
        )
    ).scalars().all()
    return _run(db, list(ids), today)


def run_all(db: Session, today: date) -> int:
    """O laco de fundo: processa as recorrentes automaticas de todos os usuarios que ja venceram."""
    ids = db.execute(
        select(Recurrence.id).where(Recurrence.auto_create.is_(True), Recurrence.active.is_(True), Recurrence.next_date <= today)
    ).scalars().all()
    return _run(db, list(ids), today)


def _run(db: Session, ids: list[uuid.UUID], today: date) -> int:
    total = 0
    for recurrence_id in ids:
        # SKIP LOCKED: se outro processo ja esta cuidando desta recorrente, deixa para ele
        recurrence = db.execute(
            select(Recurrence).where(Recurrence.id == recurrence_id).with_for_update(skip_locked=True)
        ).scalar_one_or_none()
        if recurrence is None:
            db.rollback()
            continue
        try:
            total += process_recurrence(db, recurrence, today)
            db.commit()
        except Exception:
            # Um erro inesperado numa recorrente nao pode derrubar as outras
            db.rollback()
            logger.exception("Falha ao processar a recorrente %s", recurrence_id)
    return total

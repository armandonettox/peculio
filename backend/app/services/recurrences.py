import logging
import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate
from app.models.bill import BillFrequency
from app.models.recurrence import Recurrence, RecurrenceFrequency
from app.models.user import User
from app.schemas.recurrence import RecurrenceCreate, RecurrenceUpdate
from app.schemas.transaction import TransactionCreate
from app.services import bills
from app.services.transactions import create_transaction

logger = logging.getLogger("peculio.recurrences")

# Por rodada e por recorrente: uma diaria parada por anos nao trava o laco; o resto sai na proxima
MAX_PER_RUN = 500


# ---------- Datas (funcoes puras) ----------


def occurrence(first: date, frequency: RecurrenceFrequency, index: int) -> date:
    """A data da ocorrencia de numero `index` (0 = a primeira). Conta sempre a partir da primeira, igual
    as contas a pagar: o dia 31 cai no ultimo dia dos meses curtos e volta ao 31 quando o mes tem."""
    if frequency == RecurrenceFrequency.daily:
        return first + timedelta(days=index)
    return bills.occurrence(first, BillFrequency(frequency.value), index)


def latest_index(first: date, frequency: RecurrenceFrequency, on: date) -> int | None:
    """Numero da ultima ocorrencia que ja chegou (<= on), ou None se a primeira ainda esta no futuro."""
    if on < first:
        return None
    if frequency == RecurrenceFrequency.daily:
        return (on - first).days
    return bills.latest_index(first, BillFrequency(frequency.value), on)


def _next_after(recurrence: Recurrence, index: int) -> date | None:
    """Data da ocorrencia `index`, ou None se a recorrente ja terminou antes dela."""
    if recurrence.max_occurrences is not None and index >= recurrence.max_occurrences:
        return None
    day = occurrence(recurrence.first_date, recurrence.frequency, index)
    if recurrence.end_date is not None and day > recurrence.end_date:
        return None
    return day


def upcoming_date(recurrence: Recurrence) -> date | None:
    """Data da proxima ocorrencia que ainda vai ser criada, ou None se esta pausada ou ja terminou."""
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


def _at(template: TransactionCreate, day: date) -> TransactionCreate:
    """O modelo com a data de cada linha trocada por `day`."""
    return template.model_copy(update={"splits": [split.model_copy(update={"date": day}) for split in template.splits]})


def _dump(template: TransactionCreate) -> dict:
    # exclude_unset: um bill_id ausente (liga sozinho) continua diferente de um bill_id null (nao liga)
    return template.model_dump(mode="json", exclude_unset=True)


def _check_template(db: Session, user: User, template: TransactionCreate, day: date) -> None:
    """Confere o modelo com as mesmas regras de um lancamento de verdade, sem gravar nada."""
    savepoint = db.begin_nested()
    try:
        create_transaction(db, user, _at(template, day))
    finally:
        savepoint.rollback()


def create_recurrence(db: Session, user: User, data: RecurrenceCreate) -> Recurrence:
    _check_template(db, user, data.template, data.first_date)
    recurrence = Recurrence(
        user_id=user.id,
        name=data.name,
        frequency=data.frequency,
        first_date=data.first_date,
        end_date=data.end_date,
        max_occurrences=data.max_occurrences,
        template=_dump(data.template),
        next_index=0,
    )
    recurrence.next_date = _next_after(recurrence, 0)
    db.add(recurrence)
    db.flush()
    return recurrence


def update_recurrence(db: Session, user: User, recurrence: Recurrence, data: RecurrenceUpdate, today: date) -> Recurrence:
    sent = data.model_fields_set
    if data.name is not None:
        recurrence.name = data.name
    if data.template is not None:
        _check_template(db, user, data.template, recurrence.next_date or recurrence.first_date)
        recurrence.template = _dump(data.template)
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
    db.flush()
    return recurrence


def _skip_missed(recurrence: Recurrence, today: date) -> None:
    """Ao retomar, o periodo pausado nao e recuperado: pausar quer dizer nao criar. Pula para a
    primeira ocorrencia que ainda nao chegou."""
    index = latest_index(recurrence.first_date, recurrence.frequency, today)
    if index is not None and index + 1 > recurrence.next_index:
        recurrence.next_index = index + 1
        recurrence.next_date = _next_after(recurrence, recurrence.next_index)
    recurrence.last_error = None


def delete_recurrence(db: Session, recurrence: Recurrence) -> None:
    # Os lancamentos ja criados ficam (ON DELETE SET NULL no banco)
    db.delete(recurrence)
    db.flush()


def to_output(recurrence: Recurrence) -> dict:
    return {
        "id": recurrence.id,
        "name": recurrence.name,
        "frequency": recurrence.frequency,
        "first_date": recurrence.first_date,
        "end_date": recurrence.end_date,
        "max_occurrences": recurrence.max_occurrences,
        "active": recurrence.active,
        "template": recurrence.template,
        "created_count": recurrence.next_index,
        "next_date": recurrence.next_date,
        "ended": recurrence.next_date is None,
        "last_error": recurrence.last_error,
        "created_at": recurrence.created_at,
    }


def list_recurrences(db: Session, user_id: uuid.UUID, params: PageParams, q: str | None, active: bool | None) -> dict:
    statement = select(Recurrence).where(Recurrence.user_id == user_id)
    if active is not None:
        statement = statement.where(Recurrence.active == active)
    if q and q.strip():
        statement = statement.where(func.lower(Recurrence.name).contains(q.strip().lower(), autoescape=True))
    # Quem esta perto de disparar primeiro; as terminadas por ultimo
    page = paginate(
        db,
        statement.order_by(Recurrence.next_date.asc().nulls_last(), func.lower(Recurrence.name), Recurrence.id),
        params,
    )
    page["items"] = [to_output(item) for item in page["items"]]
    return page


# ---------- Criar os lancamentos que faltam ----------


def process_recurrence(db: Session, recurrence: Recurrence, today: date) -> int:
    """Cria, em ordem, os lancamentos que ja deviam existir ate `today`. Devolve quantos criou.

    Cada ocorrencia e criada e contada na mesma transacao; se uma falhar, a recorrente para ali e guarda
    o motivo, e tenta de novo na proxima rodada, sem pular nenhuma data."""
    if not recurrence.active:
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
        select(Recurrence.id).where(Recurrence.user_id == user.id, Recurrence.active.is_(True), Recurrence.next_date <= today)
    ).scalars().all()
    return _run(db, list(ids), today)


def run_all(db: Session, today: date) -> int:
    """O laco de fundo: processa as recorrentes de todos os usuarios que ja venceram."""
    ids = db.execute(
        select(Recurrence.id).where(Recurrence.active.is_(True), Recurrence.next_date <= today)
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

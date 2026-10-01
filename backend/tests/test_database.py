from sqlalchemy import text

from app.core.database import NAMING_CONVENTION, Base, get_db


def test_get_db_yields_working_session():
    generator = get_db()
    db = next(generator)
    assert db.execute(text("SELECT 1")).scalar() == 1
    generator.close()


def test_base_metadata_uses_naming_convention():
    assert Base.metadata.naming_convention == NAMING_CONVENTION

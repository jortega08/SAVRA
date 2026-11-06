import os
from pathlib import Path
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["CONSENT_SECRET"] = "test-consent-secret-" + "a" * 40
os.environ["FINGERPRINT_SECRET"] = "test-import-secret-" + "b" * 40
os.environ["DATA_MODE"] = "real"
os.environ["PUBLIC_ORIGIN"] = "https://savra.test"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.main import app, settings
from app.questionnaires import load_definition, register_questionnaire


@pytest.fixture
def db():
    url = make_url(os.getenv("TEST_DATABASE_URL", "sqlite://"))
    if url.get_backend_name() == "postgresql":
        if url.database != "savra_test" or url.host not in {"db", "localhost", "127.0.0.1"}:
            raise RuntimeError("Las pruebas requieren una base local desechable savra_test")
        engine = create_engine(url)
        try:
            with engine.connect() as connection:
                transaction = connection.begin()
                try:
                    if connection.scalar(text("SELECT EXISTS (SELECT 1 FROM questionnaires)")):
                        raise RuntimeError("La base de pruebas debe estar recién migrada y vacía")
                    with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
                        yield session
                finally:
                    transaction.rollback()
        finally:
            engine.dispose()
    else:
        if str(url) != "sqlite://":
            raise RuntimeError("Las pruebas rápidas requieren SQLite en memoria")
        engine = create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        try:
            with Session(engine, expire_on_commit=False) as session:
                yield session
        finally:
            engine.dispose()


@pytest.fixture
def questionnaire(db):
    definition = load_definition(Path(__file__).resolve().parents[1] / "configuration/forms-v1.json")
    q = register_questionnaire(db, definition)
    db.commit()
    return q


@pytest.fixture
def answers(questionnaire):
    return {q.key: q.eligible_values[0] if q.eligible_values else q.options[0].value
            for q in questionnaire.questions if q.kind == "category"}


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url=settings.public_origin, headers={"Origin": settings.public_origin}) as client:
        yield client
    app.dependency_overrides.clear()

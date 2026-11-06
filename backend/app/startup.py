"""Transactional, serialized schema startup; never imports survey datasets."""
import os
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .config import get_settings


def prepare_database(engine, settings):
    from .questionnaires import active_questionnaire, load_definition, register_questionnaire
    with engine.begin() as connection:
        connection.execute(text("SET LOCAL lock_timeout = '15s'"))
        connection.execute(text("SET LOCAL statement_timeout = '120s'"))
        connection.execute(text("SELECT pg_advisory_xact_lock(724193602)"))
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            from .models import Questionnaire, SurveyResponse
            if db.scalar(select(Questionnaire.id).where(
                    (Questionnaire.version == "demo-movilidad-v1") |
                    (Questionnaire.provenance["data_mode"].as_string() == "demo"))):
                raise RuntimeError("El destino contiene un cuestionario demo")
            if active_questionnaire(db) is None:
                if db.scalar(select(SurveyResponse.id).limit(1)):
                    raise RuntimeError("Hay respuestas históricas sin cuestionario activo; requiere revisión")
                register_questionnaire(db, load_definition(settings.questionnaire_file))
            db.commit()


def main():
    try:
        settings = get_settings()
        from .database import engine
        if settings.app_env != "production":
            raise RuntimeError("Este arranque requiere APP_ENV=production")
        port = int(os.environ.get("PORT", "10000"))
        if not 1 <= port <= 65535:
            raise ValueError("PORT inválido")
        prepare_database(engine, settings)
        engine.dispose()
    except Exception:
        # Driver/configuration exceptions can contain connection strings or rows.
        print("SAVRA: arranque cancelado. Revise variables, TLS, conexión y migraciones; no se muestran credenciales.",
              file=sys.stderr)
        raise SystemExit(1) from None
    os.execvp("uvicorn", ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", str(port),
                         "--workers", "1", "--no-access-log", "--no-proxy-headers",
                         "--limit-concurrency", "32", "--timeout-keep-alive", "5"])


if __name__ == "__main__":
    main()

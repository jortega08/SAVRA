"""JSON/stdio bridge: real FastAPI + isolated PostgreSQL, no network service."""
import json
import os
from pathlib import Path
import secrets
import sys

from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError


def main():
    original = make_url(os.environ["DATABASE_URL"])
    if original.get_backend_name() != "postgresql" or original.host != "db":
        raise RuntimeError("La prueba requiere el PostgreSQL existente en db")
    database = "savra_browser_test_" + secrets.token_hex(8)
    admin = create_engine(original.set(database="postgres"), isolation_level="AUTOCOMMIT")
    created = False
    engine = None
    try:
        with admin.connect() as db:
            db.execute(text(f'CREATE DATABASE "{database}"'))
            created = True
        os.environ.update(DATABASE_URL=original.set(database=database).render_as_string(hide_password=False),
                          CONSENT_SECRET=secrets.token_hex(32), FINGERPRINT_SECRET=secrets.token_hex(32),
                          PUBLIC_ORIGIN=os.environ.get("SAVRA_QA_ORIGIN", "http://localhost:8082"), DATA_MODE="real")
        from fastapi.testclient import TestClient
        from alembic import command
        from alembic.config import Config
        from app.database import engine as application_engine, SessionLocal
        from app.main import app, settings
        from app.models import SurveyResponse
        from app.questionnaires import load_definition, register_questionnaire
        engine = application_engine
        command.upgrade(Config("alembic.ini"), "head")
        with SessionLocal.begin() as db:
            register_questionnaire(db, load_definition(Path("configuration/forms-v1.json")))
        fail_next = False

        def fail_insert(connection, cursor, statement, parameters, context, executemany):
            nonlocal fail_next
            if fail_next and statement.lstrip().startswith("INSERT INTO answers"):
                fail_next = False
                raise OperationalError("INSERT", {}, Exception("isolated storage failure"))

        event.listen(engine, "before_cursor_execute", fail_insert)
        with TestClient(app, base_url=settings.public_origin) as client:
            print(json.dumps({"ready": True, "database": database}), flush=True)
            for line in sys.stdin:
                request = json.loads(line)
                if request.get("op") == "shutdown":
                    break
                if request.get("op") == "count":
                    with SessionLocal() as db:
                        result = {"count": db.scalar(select(func.count()).select_from(SurveyResponse))}
                elif request.get("op") == "fail_next":
                    fail_next = True
                    result = {"ok": True}
                else:
                    # The browser owns cookies; never share a TestClient cookie jar
                    # between browser contexts/profiles.
                    client.cookies.clear()
                    response = client.request(request["method"], request["path"],
                                              headers=request["headers"], content=request.get("body"))
                    result = {"status": response.status_code, "body": response.text,
                              "headers": dict(response.headers), "cookies": response.headers.get_list("set-cookie")}
                print(json.dumps(result), flush=True)
    finally:
        if engine is not None:
            engine.dispose()
        if created:
            with admin.connect() as db:
                db.execute(text(f'DROP DATABASE "{database}" WITH (FORCE)'))
        admin.dispose()


if __name__ == "__main__":
    main()

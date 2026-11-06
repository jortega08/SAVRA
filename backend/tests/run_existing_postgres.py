"""Run rollback-isolated suites in a new database on the existing PostgreSQL."""
import os
import secrets
import subprocess

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def main():
    url = make_url(os.environ["DATABASE_URL"])
    if url.get_backend_name() != "postgresql" or url.host != "db" or url.database == "savra_test":
        raise RuntimeError("Se requiere el backend existente con PostgreSQL local")
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    created = False
    try:
        with admin.connect() as db:
            # Fail if another suite owns this database; never reuse/drop it.
            db.execute(text("CREATE DATABASE savra_test"))
            created = True
        test_url = url.set(database="savra_test").render_as_string(hide_password=False)
        env = {**os.environ, "DATABASE_URL": test_url, "TEST_DATABASE_URL": test_url,
               "CONSENT_SECRET": secrets.token_hex(32), "FINGERPRINT_SECRET": secrets.token_hex(32),
               "PUBLIC_ORIGIN": "https://savra.test", "DATA_MODE": "real"}
        for command in (["alembic", "upgrade", "head"], ["python", "-m", "pytest", "-q"], ["alembic", "check"]):
            subprocess.run(command, env=env, check=True)
    finally:
        if created:
            with admin.connect() as db:
                db.execute(text("DROP DATABASE savra_test WITH (FORCE)"))
        admin.dispose()


if __name__ == "__main__":
    main()

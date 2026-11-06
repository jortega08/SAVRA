"""Exercise the actual production image against disposable PostgreSQL over TLS."""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

from test_isolated import ROOT, docker, run_container, tls_certificate, wait_until

IMAGE = "savra-render:preparacion"


def main():
    (ROOT / ".local/release-audit").mkdir(parents=True, exist_ok=True)
    token = secrets.token_hex(12)
    prefix = "savra-render-qa-" + token
    env = {**os.environ, "POSTGRES_DB": "savra_test", "POSTGRES_USER": "savra",
           "POSTGRES_PASSWORD": secrets.token_hex(24), "CONSENT_SECRET": secrets.token_hex(32),
           "FINGERPRINT_SECRET": secrets.token_hex(32), "PUBLIC_ORIGIN": "https://savra.test:8443", "PORT": "10007"}
    env["DATABASE_URL"] = (f"postgresql://savra:{env['POSTGRES_PASSWORD']}@db:5432/savra_test"
                           "?sslmode=require&channel_binding=require")
    app_env = [part for key in ("DATABASE_URL", "CONSENT_SECRET", "FINGERPRINT_SECRET", "PUBLIC_ORIGIN", "PORT")
               for part in ("-e", key)]
    with ExitStack() as stack:
        directory = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix=prefix)))
        tls_certificate(directory)
        docker("network", "create", prefix, capture_output=True)
        stack.callback(docker, "network", "rm", prefix, capture_output=True, check=False)
        db = prefix + "-db"
        run_container(stack, db, "--network", prefix, "--network-alias", "db", "--tmpfs", "/var/lib/postgresql/data",
                      "--mount", f"type=bind,source={directory},target=/tls,readonly",
                      "-e", "POSTGRES_DB", "-e", "POSTGRES_USER", "-e", "POSTGRES_PASSWORD", "postgres:17-alpine",
                      "sh", "-ec", "cp /tls/key.pem /tmp/server.key; cp /tls/cert.pem /tmp/server.crt; "
                      "chown postgres:postgres /tmp/server.key /tmp/server.crt; chmod 600 /tmp/server.key; "
                      "exec docker-entrypoint.sh postgres -c ssl=on -c ssl_key_file=/tmp/server.key -c ssl_cert_file=/tmp/server.crt",
                      env=env)
        wait_until(lambda: docker("exec", db, "pg_isready", "-h", "127.0.0.1", "-U", "savra", "-d", "savra_test",
                                  check=False, capture_output=True).returncode == 0, "PostgreSQL TLS desechable")
        # A failed bootstrap must roll back the entire schema, not leave half a migration.
        failed = docker("run", "--rm", "--network", prefix, *app_env, "-e", "QUESTIONNAIRE_FILE=/missing.json",
                        IMAGE, env=env, check=False, capture_output=True)
        assert failed.returncode != 0
        empty = docker("exec", db, "psql", "-U", "savra", "-d", "savra_test", "-Atc",
                       "SELECT count(*) FROM pg_tables WHERE schemaname='public'", capture_output=True, text=True)
        assert empty.stdout.strip() == "0", "La migración fallida no se revirtió"
        app = prefix + "-app"
        run_container(stack, app, "--network", prefix, "--memory=512m", "--memory-swap=512m", "--read-only",
                      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", "-p", "127.0.0.1:8083:10007", *app_env, IMAGE, env=env)

        def healthy():
            return docker("exec", app, "python", "-c",
                          "from urllib.request import urlopen; urlopen('http://127.0.0.1:10007/api/health',timeout=3)",
                          check=False, capture_output=True).returncode == 0

        wait_until(healthy, "servicio de producción")
        probe = """from pathlib import Path
import importlib.util
from app.database import engine
from sqlalchemy import text
assert all(importlib.util.find_spec(p) is None for p in ['pandas','openpyxl','pytest'])
assert not Path('/app/app/processing').exists()
assert not Path('/app/app/cli.py').exists()
assert not Path('/app/configuration/demo-movilidad-v1.json').exists()
assert not Path('/app/.env').exists()
assert not any(Path('/app').rglob('*.xlsx'))
with engine.connect() as c:
    assert c.scalar(text('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()'))
print('TLS PostgreSQL y contenido mínimo de la imagen: correctos')
"""
        docker("exec", app, "python", "-c", probe)
        env.update(SAVRA_PRODUCTION_TEST=token, SAVRA_E2E_TLS=str(directory))
        subprocess.run(["node", "node_modules/@playwright/test/cli.js", "test", "--config=playwright.production.config.ts"],
                       cwd=ROOT / "frontend", env=env, check=True)

        usage = json.loads(docker("stats", "--no-stream", "--format", "{{json .}}", app,
                                  capture_output=True, text=True).stdout)["MemUsage"]
        manifest_args = ("python", "tools/database_manifest.py", "--expect-responses", "1", "--expect-answers", "18", "--json")
        before = json.loads(docker("exec", app, *manifest_args, capture_output=True, text=True).stdout)
        docker("restart", app, capture_output=True)
        wait_until(healthy, "reinicio idempotente")
        after = json.loads(docker("exec", app, *manifest_args, capture_output=True, text=True).stdout)
        assert before == after, "El reinicio cambió los datos"
        # Rehearse the documented binary dump/restore only with this test fixture.
        archive = docker("exec", db, "pg_dump", "-Fc", "--no-owner", "--no-acl", "-U", "savra", "savra_test",
                         capture_output=True).stdout
        docker("exec", db, "createdb", "-U", "savra", "savra_restore", capture_output=True)
        docker("exec", "-i", db, "pg_restore", "-U", "savra", "--dbname", "savra_restore", "--single-transaction",
               "--exit-on-error", "--no-owner", "--no-acl", "--no-comments", "--no-security-labels",
               input=archive, capture_output=True)
        restored_env = {**env, "DATABASE_URL": env["DATABASE_URL"].replace("/savra_test?", "/savra_restore?")}
        restored = json.loads(docker("exec", "-e", "DATABASE_URL", app, *manifest_args,
                                     env=restored_env, capture_output=True, text=True).stdout)
        assert before == restored, "El dump/restore aislado no conserva el manifiesto"
        stats = json.loads(docker("stats", "--no-stream", "--format", "{{json .}}", app,
                                  capture_output=True, text=True).stdout)
        state = json.loads(docker("inspect", "--format", "{{json .State}}", app, capture_output=True, text=True).stdout)
        assert not state["OOMKilled"]
        print("Arranque, rollback, TLS, navegación, cookies HTTPS, guardado, reinicio y dump/restore aislado: correctos.")
        print("Memoria tras reiniciar:", stats["MemUsage"])
        (ROOT / ".local/release-audit/production.json").write_text(
            json.dumps({"passed": True, "memory_after_browser": usage, "memory_after_restart": stats["MemUsage"], "limit": "512 MiB", "oom": False}, indent=2),
            encoding="utf-8")


if __name__ == "__main__":
    main()

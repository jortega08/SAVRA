"""Run SAVRA suites on disposable Docker resources and local browser fixtures."""
import argparse
from contextlib import ExitStack
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
API_ORIGIN = "http://localhost:8082"
BACKEND_IMAGE = "savra-backend:latest"
PROXY_IMAGE = "savra-frontend:latest"


def docker(*args, env=None, check=True, **kwargs):
    return subprocess.run(["docker", *args], cwd=ROOT, env=env, check=check, **kwargs)


def wait_until(probe, label):
    for _ in range(60):
        if probe():
            return
        time.sleep(1)
    raise RuntimeError(f"No se pudo iniciar {label}")


def run_container(stack, name, *args, env=None):
    # Register cleanup before run in case Docker creates a container and fails to start it.
    stack.callback(docker, "rm", "-f", name, check=False, capture_output=True)
    docker("run", "--detach", "--rm", "--name", name, *args, env=env)


def tls_certificate(directory):
    openssl = shutil.which("openssl")
    git = shutil.which("git")
    if not openssl and git and os.name == "nt":
        bundled = Path(git).parents[1] / "usr/bin/openssl.exe"
        if bundled.is_file():
            openssl = str(bundled)
    if not openssl:
        raise RuntimeError("OpenSSL es necesario para la prueba HTTPS")
    subprocess.run([openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", "/CN=savra.test", "-addext", "subjectAltName=DNS:savra.test,IP:127.0.0.1",
                    "-keyout", str(directory / "key.pem"), "-out", str(directory / "cert.pem")],
                   check=True, capture_output=True)


def run_suite(suite):
    demo = suite == "demo"
    database = "savra_demo" if demo else "savra_test"
    token = secrets.token_hex(16)
    prefix = f"savra-qa-{token[:12]}"
    password = secrets.token_hex(24)
    url = f"postgresql+psycopg://savra:{password}@db:5432/{database}"
    origin = "https://savra.test:8443" if suite == "https" else API_ORIGIN
    env = {**os.environ, "POSTGRES_DB": database, "POSTGRES_USER": "savra", "POSTGRES_PASSWORD": password,
           "DATABASE_URL": url, "TEST_DATABASE_URL": url, "DATA_MODE": "demo" if demo else "real",
           "QUESTIONNAIRE_FILE": "/app/configuration/" + ("demo-movilidad-v1.json" if demo else "forms-v1.json"),
           "CONSENT_SECRET": secrets.token_hex(32), "FINGERPRINT_SECRET": secrets.token_hex(32),
           "PUBLIC_ORIGIN": origin}
    settings = ("DATABASE_URL", "TEST_DATABASE_URL", "DATA_MODE", "QUESTIONNAIRE_FILE",
                "CONSENT_SECRET", "FINGERPRINT_SECRET", "PUBLIC_ORIGIN")
    backend_env = [arg for key in settings for arg in ("-e", key)]

    with ExitStack() as stack:
        directory = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="savra-qa-")))
        network = prefix
        docker("network", "create", network)
        stack.callback(docker, "network", "rm", network)
        db = f"{prefix}-db"
        run_container(stack, db, "--network", network, "--network-alias", "db",
                      "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_DB", "-e", "POSTGRES_USER",
                      "-e", "POSTGRES_PASSWORD", "postgres:17-alpine", env=env)
        wait_until(lambda: docker("exec", db, "pg_isready", "-h", "127.0.0.1", "-U", "savra", "-d", database,
                                  check=False, capture_output=True).returncode == 0, "PostgreSQL desechable")

        backend = f"{prefix}-backend"
        if suite == "backend":
            stack.callback(docker, "rm", "-f", backend, check=False, capture_output=True)
            docker("run", "--rm", "--name", backend, "--network", network, *backend_env, BACKEND_IMAGE,
                   "sh", "-ec", "alembic upgrade head && pytest -q && alembic check", env=env)
            return

        run_container(stack, backend, "--network", network, "--network-alias", "backend",
                      *backend_env, BACKEND_IMAGE, env=env)
        wait_until(lambda: docker("exec", backend, "python", "-c",
                                  "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/api/health', timeout=2)",
                                  check=False, capture_output=True).returncode == 0, "FastAPI de pruebas")
        if demo:
            docker("exec", backend, "python", "-m", "app.cli", "generate-demo")
        else:
            docker("exec", "-e", "PYTHONPATH=/app", backend, "python", "tests/browser_seed.py")

        # Use the same API gateway rules with an empty web root. Playwright
        # fulfills static requests from dist only inside its browser context.
        config = (ROOT / "frontend/nginx.conf").read_text(encoding="utf-8")
        config_path = directory / "nginx.conf"
        marker = f"location = /__savra_e2e {{ return 200 '{token}'; }}"
        config_path.write_text(config.replace("server_name _;", f"server_name _;\n    {marker}"), encoding="utf-8")
        run_container(stack, f"{prefix}-api", "--network", network,
                      "-p", "127.0.0.1:8082:8080", "--tmpfs", "/usr/share/nginx/html",
                      "--mount", f"type=bind,source={config_path},target=/etc/nginx/nginx.conf,readonly", PROXY_IMAGE)

        def isolated_proxy_ready():
            try:
                with urlopen(f"{API_ORIGIN}/__savra_e2e", timeout=2) as response:
                    if response.read().decode() != token:
                        return False
                with urlopen(f"{API_ORIGIN}/api/health", timeout=2) as response:
                    return response.status == 200
            except (URLError, TimeoutError):
                return False

        wait_until(isolated_proxy_ready, "proxy de API aislado")
        if suite == "https":
            tls_certificate(directory)
        env.update(SAVRA_E2E_TOKEN=token, SAVRA_E2E_TLS=str(directory))
        specs = {"browser": ["phase2.spec.ts", "savra.spec.ts", "break.spec.ts"],
                 "demo": ["demo.spec.ts", "visualizations.spec.ts"], "https": ["public.spec.ts"]}[suite]
        frontend = ROOT / "frontend"
        subprocess.run(["node", "node_modules/@playwright/test/cli.js", "test", *specs],
                       cwd=frontend, env=env, check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suites", choices=("backend", "browser", "demo", "https"), nargs="+")
    for selected in parser.parse_args().suites:
        run_suite(selected)

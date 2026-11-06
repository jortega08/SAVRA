"""Explicit future restore into an empty Neon database. Never reads the local DB."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import parse_qs, unquote, urlsplit
from neon_preflight import check_target

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--confirm-empty-neon", action="store_true", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--preflight", type=Path, required=True)
    args = parser.parse_args()
    try:
        archive = args.archive.resolve(strict=True)
        archive.relative_to(ROOT / ".local")
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest.lower() != args.expected_sha256.lower():
            raise ValueError("El respaldo no coincide con su SHA-256")
        approved_target = json.loads(args.preflight.read_text(encoding="utf-8"))
        current_target = check_target(os.environ["NEON_DATABASE_URL"])
        for field in ("host", "database", "role", "server_version_num"):
            if current_target[field] != approved_target[field]:
                raise ValueError("Cambió el destino desde el preflight")
        if approved_target.get("project") != "savra-real" or not approved_target.get("direct_connection"):
            raise ValueError("No se ha verificado el proyecto de destino")
        url = urlsplit(os.environ["NEON_DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1))
        if (url.scheme not in {"postgres", "postgresql"} or not (url.hostname or "").endswith(".neon.tech")
                or "-pooler." in url.hostname or not url.username or not url.password or not url.path.strip("/")):
            raise ValueError("Se requiere conexión directa de Neon")
        query = parse_qs(url.query)
        if query.get("sslmode", [""])[0] not in {"require", "verify-full"}:
            raise ValueError("Se requiere TLS")
        env = {**os.environ, "PGHOST": url.hostname, "PGPORT": str(url.port or 5432),
               "PGDATABASE": unquote(url.path[1:]), "PGUSER": unquote(url.username), "PGPASSWORD": unquote(url.password),
               "PGSSLMODE": query["sslmode"][0], "PGCHANNELBINDING": "require", "PGCONNECT_TIMEOUT": "15"}
        if env["PGSSLMODE"] == "verify-full":
            # Use the system CA store of the PostgreSQL client image.
            env["PGSSLROOTCERT"] = "system"
        names = ("PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGCHANNELBINDING", "PGCONNECT_TIMEOUT")
        inherited = [item for name in names for item in ("-e", name)]
        if "PGSSLROOTCERT" in env:
            inherited += ["-e", "PGSSLROOTCERT"]
        base = ["docker", "run", "--rm", "-i", *inherited, "postgres:18.6-alpine"]
        empty = subprocess.run([*base, "psql", "-X", "--no-password", "-Atc",
                                "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                                "WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f')"],
                               env=env, capture_output=True, check=True)
        if empty.stdout.strip() != b"0":
            raise ValueError("El destino no está vacío")
        with archive.open("rb") as source:
            subprocess.run([*base, "pg_restore", "--dbname", env["PGDATABASE"], "--single-transaction",
                            "--exit-on-error", "--no-owner", "--no-acl", "--no-comments", "--no-security-labels", "--no-tablespaces"],
                           env=env, stdin=source, capture_output=True, check=True)
        print("Restauración terminada. Mantenga Render sin publicar hasta comparar el manifiesto completo.")
    except Exception:
        print("Restauración detenida. Revise el destino vacío, conexión directa, TLS y archivo privado. "
              "No se muestran datos ni credenciales. No reintente sobre un destino que tenga tablas.", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()

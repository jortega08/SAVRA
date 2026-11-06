"""Read-only Neon preflight. No source rows, credentials or URLs are emitted."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from urllib.parse import parse_qs, unquote, urlsplit


class PreflightError(Exception):
    def __init__(self, code, details=None):
        self.code, self.details = code, details or {}


def check_target(url):
    import psycopg
    parsed = urlsplit(url.replace("postgresql+psycopg://", "postgresql://", 1))
    query = parse_qs(parsed.query)
    if (parsed.scheme not in {"postgres", "postgresql"} or not (parsed.hostname or "").endswith(".neon.tech")
            or "-pooler." in parsed.hostname or ".us-east-1.aws.neon.tech" not in parsed.hostname
            or query.get("sslmode", [""])[0] not in {"require", "verify-full"}
            or query.get("channel_binding", [""])[0] != "require"):
        raise PreflightError("CONNECTION_FORMAT", {"uri_scheme_valid": parsed.scheme in {"postgres", "postgresql"},
                                                  "direct_host": bool(parsed.hostname and "-pooler." not in parsed.hostname),
                                                  "region_matches": bool(parsed.hostname and ".us-east-1.aws.neon.tech" in parsed.hostname),
                                                  "tls_required": query.get("sslmode", [""])[0] in {"require", "verify-full"},
                                                  "channel_binding_required": query.get("channel_binding", [""])[0] == "require"})
    with psycopg.connect(url.replace("postgresql+psycopg://", "postgresql://", 1), connect_timeout=15,
                         options="-c default_transaction_read_only=on -c statement_timeout=20000", prepare_threshold=None) as db:
        # Neon terminates client TLS at its proxy. pg_stat_ssl describes the
        # backend hop; PQsslInUse verifies the actual client connection.
        client_tls = bool(db.pgconn.ssl_in_use)
        with db.cursor() as c:
            c.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            c.execute("SELECT current_database(), current_user, current_setting('server_version'), current_setting('server_version_num')::int")
            name, role, version, number = c.fetchone()
            c.execute("SELECT ssl,version,bits FROM pg_stat_ssl WHERE pid=pg_backend_pid()")
            ssl = c.fetchone()
            c.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','S','v','m','f')")
            objects = c.fetchone()[0]
            c.execute("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')")
            routines = c.fetchone()[0]
            c.execute("SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND t.typtype IN ('e','d','c') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e')")
            types = c.fetchone()[0]
            c.execute("SELECT count(*) FROM pg_largeobject_metadata")
            blobs = c.fetchone()[0]
            if not (180000 <= number < 190000 and name == unquote(parsed.path[1:]) and client_tls
                    and objects == routines == types == blobs == 0):
                raise PreflightError("TARGET_CHECKS", {"postgresql_version_num": number, "database_matches_uri": name == unquote(parsed.path[1:]),
                                                       "tls": client_tls, "application_objects": objects,
                                                       "application_routines": routines, "application_types": types, "large_objects": blobs})
            return {"checked_at_utc": datetime.now(timezone.utc).isoformat(), "host": parsed.hostname, "database": name,
                    "role": role, "server_version": version, "server_version_num": number, "ssl": True,
                    "tls_verified_by": "libpq-PQsslInUse", "backend_ssl": bool(ssl and ssl[0]), "application_objects": objects,
                    "application_routines": routines, "application_types": types, "large_objects": blobs,
                    "direct_connection": True, "region": "aws-us-east-1"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-directory", type=Path, required=True)
    args = parser.parse_args()
    try:
        root = Path(__file__).resolve().parents[1]
        directory = args.run_directory.resolve(strict=True)
        directory.relative_to(root / ".local/neon")
        result = check_target(os.environ["NEON_DATABASE_URL"])
        identity = json.loads((directory / "target-identity.json").read_text(encoding="utf-8"))
        if (identity["project"] != "savra-real" or identity["region"] != "aws-us-east-1"
                or identity["expected_host"] != result["host"]):
            raise ValueError("El destino no coincide con el proyecto confirmado por el titular")
        if result["server_version"].split()[0] != identity["expected_version"]:
            raise PreflightError("TARGET_VERSION_CHANGED", {"server_version_num": result["server_version_num"]})
        result.update(project=identity["project"], branch=identity["branch"], project_verification="user-confirmed-console-and-endpoint-match")
        (directory / "target-preflight.json").write_text(json.dumps(result, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        print(f"Neon preflight correcto: PostgreSQL {result['server_version']}; destino vacío, conexión directa TLS; proyecto y endpoint coinciden con la confirmación del titular.")
    except Exception as error:
        if isinstance(error, PreflightError):
            print(json.dumps({"preflight_error": error.code, "checks": error.details}, ensure_ascii=True), file=sys.stderr)
        else:
            state = getattr(error, "sqlstate", None)
            print(json.dumps({"preflight_error_type": type(error).__name__, "sqlstate": state}, ensure_ascii=True), file=sys.stderr)
        print("Preflight detenido: revise conexión directa cifrada, versión 18, identidad, TLS y destino vacío. No se muestran datos ni credenciales.", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()

"""Read-only integrity manifest; never emits individual responses or credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

TABLES = ("questionnaires", "questions", "question_options", "import_batches", "responses", "answers", "alembic_version")
CHECKS = {
    "orphan_questions": "SELECT count(*) FROM questions q LEFT JOIN questionnaires p ON p.id=q.questionnaire_id WHERE p.id IS NULL",
    "orphan_options": "SELECT count(*) FROM question_options o LEFT JOIN questions q ON q.id=o.question_id WHERE q.id IS NULL",
    "orphan_batches": "SELECT count(*) FROM import_batches b LEFT JOIN questionnaires q ON q.id=b.questionnaire_id WHERE q.id IS NULL",
    "orphan_responses": "SELECT count(*) FROM responses r LEFT JOIN questionnaires q ON q.id=r.questionnaire_id WHERE q.id IS NULL",
    "orphan_response_batches": "SELECT count(*) FROM responses r LEFT JOIN import_batches b ON b.id=r.import_batch_id WHERE r.import_batch_id IS NOT NULL AND (b.id IS NULL OR b.questionnaire_id<>r.questionnaire_id)",
    "orphan_answers": "SELECT count(*) FROM answers a LEFT JOIN responses r ON r.id=a.response_id LEFT JOIN questions q ON q.id=a.question_id WHERE r.id IS NULL OR q.id IS NULL OR q.questionnaire_id<>r.questionnaire_id",
    "duplicate_answers": "SELECT count(*) FROM (SELECT response_id,question_id FROM answers GROUP BY 1,2 HAVING count(*)>1) d",
    "duplicate_fingerprints": "SELECT count(*) FROM (SELECT fingerprint FROM responses GROUP BY 1 HAVING count(*)>1) d",
    "invalid_fingerprints": "SELECT count(*) FROM responses WHERE fingerprint !~ '^[a-f0-9]{64}$' OR payload_hash !~ '^[a-f0-9]{64}$'",
    "synthetic_questionnaires": "SELECT count(*) FROM questionnaires WHERE version LIKE 'demo%' OR provenance->>'data_mode'='demo'",
    "unexpected_sources": "SELECT count(*) FROM responses WHERE source NOT IN ('microsoft_forms','integrated')",
    "missing_required_answers": "SELECT count(*) FROM responses r JOIN questions q ON q.questionnaire_id=r.questionnaire_id AND q.required LEFT JOIN answers a ON a.response_id=r.id AND a.question_id=q.id WHERE a.id IS NULL",
}


def create_manifest(url):
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url
    from sqlalchemy.pool import NullPool
    parsed = make_url(url)
    if parsed.drivername in {"postgres", "postgresql"}:
        parsed = parsed.set(drivername="postgresql+psycopg")
    if parsed.drivername != "postgresql+psycopg" or (parsed.database or "").endswith("_demo"):
        raise ValueError("Se requiere PostgreSQL real, no una base demo")
    engine = create_engine(parsed, poolclass=NullPool, hide_parameters=True,
                           connect_args={"connect_timeout": 15, "prepare_threshold": None})
    try:
        with engine.connect().execution_options(isolation_level="REPEATABLE READ") as c, c.begin():
            c.execute(text("SET TRANSACTION READ ONLY"))
            c.execute(text("SET LOCAL TIME ZONE 'UTC'"))
            c.execute(text("SET LOCAL statement_timeout = '60s'"))
            result = {"format": 1, "tables": {}, "checks": {}, "sequences": {}}
            for table in TABLES:
                order = "version_num" if table == "alembic_version" else "id"
                digest, count = hashlib.sha256(), 0
                for row in c.execute(text(f"SELECT to_jsonb(r)::text FROM {table} r ORDER BY {order}")):
                    canonical = json.dumps(json.loads(row[0]), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                    digest.update((canonical + "\n").encode("utf-8"))
                    count += 1
                result["tables"][table] = {"count": count, "sha256": digest.hexdigest()}
                if table != "alembic_version":
                    seq = c.scalar(text("SELECT pg_get_serial_sequence(:table, 'id')"), {"table": table})
                    if seq != f"public.{table}_id_seq":
                        raise ValueError("Secuencia inesperada")
                    state = dict(c.execute(text(f"SELECT last_value, is_called FROM public.{table}_id_seq")).mappings().one())
                    maximum = c.scalar(text(f"SELECT COALESCE(max(id),0) FROM {table}"))
                    if state["last_value"] + int(state["is_called"]) <= maximum:
                        raise ValueError("Una secuencia podría reutilizar IDs")
                    result["sequences"][table] = state
            result["sources"] = dict(c.execute(text("SELECT source,count(*) FROM responses GROUP BY source ORDER BY source")).all())
            result["checks"] = {name: c.scalar(text(sql)) for name, sql in CHECKS.items()}
            # Verify each stored payload hash from the complete answer set.
            bad_payloads = 0
            for row in c.execute(text("SELECT r.payload_hash,jsonb_object_agg(q.key,a.value) AS answers "
                                      "FROM responses r JOIN answers a ON a.response_id=r.id "
                                      "JOIN questions q ON q.id=a.question_id GROUP BY r.id ORDER BY r.id")):
                actual = hashlib.sha256(json.dumps(row.answers, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
                bad_payloads += actual != row.payload_hash
            result["checks"]["payload_hash_mismatches"] = bad_payloads
            if any(result["checks"].values()):
                raise ValueError("La integridad o la separación de datos requiere revisión")
            return result
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-compose", action="store_true", help="Lee únicamente la base del backend Compose existente")
    parser.add_argument("--database-env", default="DATABASE_URL", help="Nombre de variable; nunca pase una URL por argumentos")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--compare", type=Path)
    parser.add_argument("--expect-responses", type=int, required=True)
    parser.add_argument("--expect-answers", type=int, required=True)
    parser.add_argument("--json", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.local_compose:
            child = subprocess.run(["docker", "compose", "exec", "-T", "backend", "python", "-", "--json",
                                    "--expect-responses", str(args.expect_responses), "--expect-answers", str(args.expect_answers)],
                                   input=Path(__file__).read_text(encoding="utf-8"), text=True, encoding="utf-8",
                                   capture_output=True, cwd=Path(__file__).resolve().parents[1], check=True)
            manifest = json.loads(child.stdout)
        else:
            manifest = create_manifest(os.environ[args.database_env])
        if (manifest["tables"]["responses"]["count"] != args.expect_responses or
                manifest["tables"]["answers"]["count"] != args.expect_answers):
            raise ValueError("Conteos diferentes de los esperados")
        if args.compare and manifest != json.loads(args.compare.read_text(encoding="utf-8")):
            raise ValueError("Los manifiestos difieren")
        if args.output:
            if ".local" not in args.output.resolve().parts:
                raise ValueError("Guarde el manifiesto dentro de .local")
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        if args.json:
            print(json.dumps(manifest, sort_keys=True))
        else:
            print(f"Integridad correcta: {args.expect_responses} participaciones, {args.expect_answers} respuestas; "
                  "relaciones, huellas, secuencias y separación verificadas." + (" Coincidencia exacta del manifiesto." if args.compare else ""))
    except Exception:
        print("Validación detenida: revise conexión, conteos, manifiestos y relaciones. No se muestran datos ni credenciales.", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()

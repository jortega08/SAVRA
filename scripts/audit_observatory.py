"""Audita Neon en solo lectura y guarda exclusivamente agregados en .local."""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

import psycopg
from psycopg.conninfo import conninfo_to_dict
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from database_manifest import CHECKS

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ORIGIN = "https://savra-wacb.onrender.com"
PATHS = ("health", "meta", "questionnaire", "overview", "analytics/academic",
         "analytics/permanence", "analytics/institutional", "analytics/quality")
sys.path.insert(0, str(ROOT / "backend"))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def public_snapshot(paths=PATHS, filters=None):
    opener = build_opener(NoRedirect())
    snapshot = {}
    query = "?" + urlencode(filters) if filters else ""
    for path in paths:
        try:
            request = Request(f"{PUBLIC_ORIGIN}/api/{path}{query}", headers={"Cache-Control": "no-cache"}, method="GET")
            with opener.open(request, timeout=30) as response:
                body = json.load(response)
                snapshot[path] = {"http": response.status, **({"body": body} if isinstance(body, dict) else {})}
        except HTTPError as error:
            snapshot[path] = {"http": error.code}
        except (URLError, TimeoutError, ValueError):
            snapshot[path] = {"http": None}
    return snapshot


def sankey_checks(ctx, flow):
    from app.analytics import analytical_question, coarsening, cohort_context, protected_matrix, small

    x, y = flow["required_variables"]
    scoped = cohort_context(ctx)
    candidate = scoped if scoped is not None else ctx
    options = analytical_question(x).options
    groups = {
        "Movilidad activa": ["Caminando", "Bicicleta"],
        "Motocicleta": ["Motocicleta propia", "Moto como pasajero"],
        "Automóvil, taxi o aplicación": ["Automóvil propio", "Automóvil familiar o compartido",
                                       "Taxi", "Transporte solicitado por aplicación"],
        "Transporte colectivo": ["Transporte público: bus, buseta o colectivo", "Transporte universitario"],
        "Otro medio": ["Otro, especificar"],
    }
    if sorted(options) != sorted(value for values in groups.values() for value in values):
        raise ValueError("El catálogo de transporte requiere revisar los planes de diagnóstico")
    collective = groups["Transporte colectivo"]
    plans = {
        "original": {},
        "mode_families_and_two_time_bands": {x: groups, y: coarsening(y)},
        "collective_vs_other_and_two_time_bands": {
            x: {"Transporte colectivo": collective, "Otros medios": [v for v in options if v not in collective]},
            y: coarsening(y),
        },
    }
    tested = {}
    for name, rules in plans.items():
        relaxed = protected_matrix(candidate, x, y, flow, rules)
        strict = protected_matrix(candidate, x, y, flow, rules, require_filterable=True)
        tested[name] = {"passes_global_checks": bool(relaxed and relaxed["status"] == "ready"),
                        "passes_filter_checks": bool(strict and strict["status"] == "ready")}
    return {"cohort_and_legacy_complements_pass": scoped is not None,
            "raw_global_has_small_cells": any(small(n, ctx.minimum) for n in candidate.frequencies(x, y).full.values()),
            "plans": tested}


def chart_items(body):
    mobility = body.get("mobility", {})
    items = [*body.get("charts", []), *mobility.get("charts", []), *mobility.get("comparisons", []),
             *body.get("indicators", []), *body.get("quality", []), mobility.get("flow"),
             body.get("composition"), body.get("institutional_points")]
    return [item for item in items if item]


def chart_states(body):
    return [{"key": item["key"], "status": item["status"], "filterable": item.get("filterable"),
             "denominator": item.get("denominator", item.get("valid")), "message": item.get("message")}
            for item in chart_items(body)]


def chart_values(body):
    fields = ("key", "status", "data", "denominator", "missing", "coverage_percentage", "reference",
              "valid", "count", "percentage")
    return [{key: item.get(key) for key in fields} for item in chart_items(body)]


def database_snapshot(db, since, baseline):
    from app.analytics import Context, REAL_MOBILITY_KEYS, module_data, overview
    from app.models import Questionnaire
    from app.questionnaires import INTEGRATED_VERSION, payload_hash, validate_answers

    started = db.execute(text("SELECT current_timestamp, current_setting('transaction_read_only'), "
                              "current_setting('transaction_isolation'), current_setting('server_version'), "
                              "current_database()")).one()
    observed_at, readonly, isolation, server_version, database = started
    if readonly != "on" or isolation != "repeatable read":
        raise RuntimeError("Transacción sin guardas")
    questionnaires = {q.id: q for q in db.scalars(select(Questionnaire))}
    versions = {q.version: {"active": q.active, "saved": 0, "since_cut": 0 if since else None, "complete": 0}
                for q in questionnaires.values()}
    checks = {name: db.scalar(text(sql)) for name, sql in CHECKS.items()}
    checks.update(payload_hash_mismatches=0, invalid_submissions=0)
    mobility = dict.fromkeys(REAL_MOBILITY_KEYS, 0)
    # Individual values remain transient in memory for the existing validation
    # and hashing rules. Only the aggregate counters are returned or written.
    rows = db.execute(text("""
        SELECT r.questionnaire_id, r.created_at, r.payload_hash,
               coalesce(jsonb_object_agg(q.key, a.value) FILTER (WHERE q.id IS NOT NULL), '{}'::jsonb)
        FROM public.responses r LEFT JOIN public.answers a ON a.response_id = r.id
        LEFT JOIN public.questions q ON q.id = a.question_id AND q.questionnaire_id = r.questionnaire_id
        GROUP BY r.id
    """)).yield_per(100)
    for qid, created, digest, answers in rows:
        if qid not in questionnaires:
            continue
        q = questionnaires[qid]
        counts = versions[q.version]
        counts["saved"] += 1
        if since is not None:
            counts["since_cut"] += int(created >= since)
        hash_ok = payload_hash(answers) == digest
        checks["payload_hash_mismatches"] += not hash_ok
        try:
            valid = validate_answers(q, answers) == answers
        except ValueError:
            valid = False
        checks["invalid_submissions"] += not valid
        counts["complete"] += hash_ok and valid
        if q.version == INTEGRATED_VERSION:
            for key in mobility:
                mobility[key] += bool(answers.get(key))
    total = sum(item["saved"] for item in versions.values()) + checks["orphan_responses"]
    analysis = {"overview": overview(db)}
    analysis.update({f"analytics/{module}": module_data(db, module)
                     for module in ("academic", "permanence", "institutional", "quality", "methodology")})
    ctx = Context(db)
    # Distinguish a compatible definition from positive observed coverage.
    academic = analysis["analytics/academic"]
    compatibility = {}
    for chart in [*analysis["overview"]["charts"], *academic["charts"], *academic["mobility"]["charts"],
                  *academic["mobility"]["comparisons"], academic["mobility"].get("flow"),
                  *analysis["analytics/permanence"]["charts"], *analysis["analytics/institutional"]["charts"]]:
        if not chart:
            continue
        keys = chart["required_variables"]
        compatible = [q.version for q in questionnaires.values()
                      if all(any(question.key == key and question.id in ctx.ids[key] for question in q.questions)
                             for key in keys)]
        compatibility[chart["key"]] = {"compatible_versions": compatible,
                                        "has_joint_values": bool(ctx.frequencies(*keys).full)}
    report = {
        "observed_at_utc": observed_at.astimezone(timezone.utc).isoformat(), "postgresql": server_version, "database": database,
        "transaction": {"read_only": True, "isolation": isolation, "tls": True},
        "saved_total": total, "versions": versions, "baseline": baseline,
        "net_since_baseline": total - baseline if baseline is not None else None,
        "since_utc": since.astimezone(timezone.utc).isoformat() if since else None, "checks": checks, "mobility_v2": mobility,
        "local_analytics": {path: {"eligible_responses": body["eligible_responses"], "charts": chart_states(body)}
                            for path, body in analysis.items()},
        "coverage": compatibility,
        "sankey": sankey_checks(ctx, academic["mobility"]["flow"]) if academic["mobility"].get("flow") else None,
    }
    return report, {path: chart_values(body) for path, body in analysis.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", type=datetime.fromisoformat, help="Corte ISO 8601 con zona horaria")
    parser.add_argument("--baseline", type=int, help="Total guardado al corte de referencia")
    parser.add_argument("--output", default="observatory-audit/private.json", help="Ruta relativa a .local")
    parser.add_argument("--verify-filters", action="store_true", help="Consulta también los filtros publicados por Render")
    args = parser.parse_args()
    private = ROOT / ".local"
    output = (private / args.output).resolve()
    if private.is_symlink() or not output.is_relative_to(private) or output.suffix != ".json":
        parser.error("El informe debe guardarse en un archivo JSON dentro de .local")
    if args.since and args.since.utcoffset() is None:
        parser.error("El corte requiere zona horaria explícita")
    if args.baseline is not None and args.baseline < 0:
        parser.error("El total de referencia debe ser positivo o cero")
    try:
        dsn = os.environ["SAVRA_AUDIT_DSN"]
        connection = conninfo_to_dict(dsn)
        host = connection.get("host", "")
        expected_db = os.environ["SAVRA_AUDIT_DATABASE"]
        if (host != os.environ["SAVRA_AUDIT_HOST"] or not host.endswith(".neon.tech") or "-pooler." in host
                or connection.get("dbname") != expected_db or "hostaddr" in connection
                or connection.get("sslmode") not in {"require", "verify-full"}
                or connection.get("channel_binding") != "require"):
            raise ValueError("Destino o transporte no verificado")

        def connect():
            db = psycopg.connect(dsn, connect_timeout=15, prepare_threshold=None,
                                 options="-c default_transaction_read_only=on -c statement_timeout=30000 "
                                         "-c search_path=public,pg_catalog")
            if not db.pgconn.ssl_in_use:
                db.close()
                raise RuntimeError("TLS requerido")
            return db

        # Bracket the database snapshot with public reads to flag concurrent
        # submissions instead of interpreting a moving total as a data defect.
        before = public_snapshot()
        os.environ.update(DATA_MODE="real", DATABASE_URL="sqlite://", APP_ENV="local",
                          CONSENT_SECRET="audit-unused-consent-secret-local-only",
                          FINGERPRINT_SECRET="audit-unused-fingerprint-secret-local-only",
                          MIN_GROUP_SIZE=str(before["overview"].get("body", {}).get("minimum_group_size", 5)))
        engine = create_engine("postgresql+psycopg://", creator=connect, poolclass=NullPool, hide_parameters=True)
        try:
            with engine.connect().execution_options(isolation_level="REPEATABLE READ",
                                                     postgresql_readonly=True) as connection, Session(connection) as db:
                report, values = database_snapshot(db, args.since, args.baseline)
                if report["database"] != expected_db:
                    raise ValueError("Base inesperada")
        finally:
            engine.dispose()
        after = public_snapshot()
        total = report["saved_total"]
        report["public"] = {}
        for path, item in after.items():
            body = item.get("body", {})
            old = before[path].get("body", {})
            local = report["local_analytics"].get(path)
            checks = {"http_before": before[path]["http"], "http": item["http"], "json_keys": sorted(body)}
            if local and "eligible_responses" in body:
                checks.update(eligible_responses=body["eligible_responses"],
                              matches_saved=old.get("eligible_responses") == body["eligible_responses"] == total,
                              stable_payload=old == body,
                              chart_states_match=chart_states(body) == local["charts"],
                              published_values_match=chart_values(body) == values[path],
                              charts=chart_states(body))
            if path == "questionnaire":
                checks["version"] = body.get("version")
            report["public"][path] = checks
        if args.verify_filters:
            filters = after["overview"].get("body", {}).get("filters", {})
            # These are the only dimensions the public endpoints expose.
            selections = [{key: value} for key in ("university", "semester") for value in filters.get(key, [])]
            selections += [{"university": u, "semester": s} for u in filters.get("university", [])
                           for s in filters.get("semester", [])]
            report["filtered_public"] = [
                {path: {"http": item["http"], "charts": chart_states(item.get("body", {}))}
                 for path, item in public_snapshot(PATHS[3:], selection).items()}
                for selection in selections
            ]
        report["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x", encoding="utf-8") as file:
            json.dump(report, file, ensure_ascii=False, indent=2)
            file.write("\n")
        print("Auditoría guardada en .local.")
        public_failed = any(item["http"] != 200 or not item["json_keys"] for item in report["public"].values())
        filter_failed = any(item["http"] != 200 for selection in report.get("filtered_public", [])
                            for item in selection.values())
        return int(any(report["checks"].values()) or public_failed or filter_failed)
    except Exception as error:
        print(f"Auditoría detenida. Tipo: {type(error).__name__}. No se muestran datos ni credenciales.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

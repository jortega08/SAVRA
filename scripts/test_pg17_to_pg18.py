"""Rehearse logical upgrade with fixtures only, on disposable isolated servers."""
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess

from test_isolated import ROOT, docker, run_container, wait_until


def main():
    prefix = "savra-upgrade-qa-" + secrets.token_hex(8)
    password = secrets.token_hex(24)
    env = {**os.environ, "POSTGRES_DB": "savra_test", "POSTGRES_USER": "savra", "POSTGRES_PASSWORD": password,
           "CONSENT_SECRET": secrets.token_hex(32), "FINGERPRINT_SECRET": secrets.token_hex(32),
           "PUBLIC_ORIGIN": "https://savra.test", "DATA_MODE": "real", "APP_ENV": "test",
           "DATABASE_URL": f"postgresql+psycopg://savra:{password}@db/savra_test",
           "TEST_DATABASE_URL": f"postgresql+psycopg://savra:{password}@db/savra_test",
           "SAVRA_QA_ROLE_PASSWORD": secrets.token_hex(24)}
    settings = [part for key in ("DATABASE_URL", "TEST_DATABASE_URL", "CONSENT_SECRET", "FINGERPRINT_SECRET", "PUBLIC_ORIGIN", "DATA_MODE", "APP_ENV") for part in ("-e", key)]
    image = "savra-backend:latest"
    with ExitStack() as stack:
        docker("network", "create", "--internal", prefix, capture_output=True)
        stack.callback(docker, "network", "rm", prefix, check=False, capture_output=True)
        source, target = prefix + "-17", prefix + "-18"
        for name, alias, version, mount in ((source, "db", "17.11", "/var/lib/postgresql/data"), (target, "target", "18.6", "/var/lib/postgresql")):
            run_container(stack, name, "--network", prefix, "--network-alias", alias, "--tmpfs", mount,
                          "-e", "POSTGRES_DB", "-e", "POSTGRES_USER", "-e", "POSTGRES_PASSWORD", f"postgres:{version}-alpine", env=env)
            wait_until(lambda name=name: docker("exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "savra", "-d", "savra_test", check=False, capture_output=True).returncode == 0, "PostgreSQL " + version)
            # No anonymous/persistent volumes; only the intended memory filesystem.
            mounts = json.loads(docker("inspect", "--format", "{{json .Mounts}}", name, capture_output=True, text=True).stdout)
            assert all(item["Type"] == "tmpfs" for item in mounts)
        bind = ("--mount", f"type=bind,source={ROOT / 'backend'},target=/app,readonly")
        docker("run", "--rm", "--network", prefix, *settings, *bind, image,
               "sh", "-ec", "alembic upgrade head && alembic check", env=env)
        seed = '''from pathlib import Path
import hashlib
from sqlalchemy import text
from app.database import SessionLocal
from app.models import Answer,SurveyResponse
from app.questionnaires import register_questionnaire,load_definition,validate_answers,payload_hash
with SessionLocal.begin() as db:
    assert db.bind.url.host=='db' and db.scalar(text('SELECT current_database()'))=='savra_test'
    old=register_questionnaire(db,load_definition(Path('configuration/forms-v1.json')))
    new=register_questionnaire(db,load_definition(Path('configuration/savra-integrada-v2.json')))
    for index,q in enumerate((old,new)):
        questions={item.key:item for item in q.questions}
        values={item.key:(item.eligible_values or [o.value for o in item.options])[0] for item in q.questions if item.kind=='category'}
        if q.id==new.id:
            for key,rule in q.provenance['conditional_text'].items():
                values[rule['question']]=rule['value']; values[key]='Fixture Unicode: biología, comillas " y salto\\ncontrolado.'
        values['open_comment']='PRUEBA AISLADA — ningún registro real.'
        values=validate_answers(q,values)
        row=SurveyResponse(questionnaire_id=q.id,source='integrated',fingerprint=hashlib.sha256(f'upgrade-fixture-{index}'.encode()).hexdigest(),payload_hash=payload_hash(values))
        db.add(row); db.flush(); db.add_all(Answer(response_id=row.id,question_id=questions[key].id,value=value) for key,value in values.items())
'''
        docker("run", "--rm", "-i", "--network", prefix, *settings, *bind, image, "python", "-", env=env,
               input=seed.encode("utf-8"), capture_output=True)
        manifest_source = (ROOT / "scripts/database_manifest.py").read_bytes()
        args = ("--json", "--expect-responses", "2", "--expect-answers", "45")
        def manifest(environment):
            return json.loads(docker("run", "--rm", "-i", "--network", prefix, *settings, image, "python", "-", *args,
                                     env=environment, input=manifest_source, capture_output=True).stdout)
        before = manifest(env)
        dump_version = docker("exec", source, "pg_dump", "--version", capture_output=True, text=True).stdout.strip()
        restore_version = docker("exec", target, "pg_restore", "--version", capture_output=True, text=True).stdout.strip()
        assert "17.11" in dump_version and "18.6" in restore_version
        archive = docker("exec", source, "pg_dump", "-Fc", "--quote-all-identifiers", "--no-owner", "--no-acl", "--no-tablespaces", "-U", "savra", "savra_test", capture_output=True).stdout
        assert archive.startswith(b"PGDMP")
        # Restore as a database-owning role without superuser privileges.
        setup = b"\\getenv role_password SAVRA_QA_ROLE_PASSWORD\nCREATE ROLE migration_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'role_password';\nCREATE DATABASE savra_restore OWNER migration_owner TEMPLATE template0;\n"
        docker("exec", "-i", "-e", "SAVRA_QA_ROLE_PASSWORD", target, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "savra", "-d", "postgres", env=env, input=setup, capture_output=True)
        docker("exec", "-i", target, "pg_restore", "-U", "migration_owner", "--dbname", "savra_restore", "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "--no-comments", "--no-security-labels", "--no-tablespaces", input=archive, capture_output=True)
        target_env = {**env, "DATABASE_URL": f"postgresql+psycopg://migration_owner:{env['SAVRA_QA_ROLE_PASSWORD']}@target/savra_restore"}
        after = manifest(target_env)
        assert before == after, "Conteos, relaciones, huellas o secuencias no coinciden"
        check = '''from app.database import SessionLocal
from sqlalchemy import text
from app.analytics import module_data,overview
with SessionLocal() as db:
    assert not db.scalar(text('SELECT rolsuper FROM pg_roles WHERE rolname=current_user'))
    assert db.scalar(text('SHOW server_version_num'))=='180006'
    assert db.scalar(text('SELECT version FROM questionnaires WHERE active'))=='savra-integrada-v2'
    assert overview(db)['eligible_responses'] is None
    for module in ('academic','permanence','institutional','quality','methodology'):
        assert module_data(db,module)['status']=='insufficient'
'''
        docker("run", "--rm", "-i", "--network", prefix, *settings, *bind, image, "python", "-", env=target_env, input=check.encode(), capture_output=True)
        docker("run", "--rm", "--network", prefix, *settings, *bind, image, "sh", "-ec", "alembic current && alembic upgrade head && alembic check", env=target_env)
        assert after == manifest(target_env), "Alembic alteró los datos restaurados"
        assert before == manifest(env), "El ensayo modificó el origen de prueba"
        target_tests = {**env, "DATABASE_URL": f"postgresql+psycopg://savra:{password}@db/savra_test", "TEST_DATABASE_URL": f"postgresql+psycopg://savra:{password}@db/savra_test"}
        # Same fixture DB name/host guard as the existing suite, on a separate network.
        docker("network", "disconnect", prefix, source, capture_output=True)
        docker("network", "disconnect", prefix, target, capture_output=True)
        docker("network", "connect", "--alias", "db", prefix, target, capture_output=True)
        docker("run", "--rm", "--network", prefix, *settings, *bind, image, "sh", "-ec",
               "alembic upgrade head && pytest -q -p no:cacheprovider && alembic check", env=target_tests)
        result = {"passed": True, "source_server": "17.11", "target_server": "18.6", "pg_dump": dump_version,
                  "pg_restore": restore_version, "fixture_responses": 2, "fixture_answers": 45,
                  "manifest_exact_match": True, "non_superuser_restore": True, "alembic_no_changes": True,
                  "archive_sha256": hashlib.sha256(archive).hexdigest(), "real_data_used": False}
        directory = ROOT / ".local/neon"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "pg17-to-pg18-test.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result))


if __name__ == "__main__":
    main()

"""Test using existing SAVRA containers; no new container, network or service."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def docker(*args, **kwargs):
    return subprocess.run(["docker", "compose", *args], cwd=ROOT, check=True, **kwargs)


def real_snapshot():
    code = """from app.database import SessionLocal
from sqlalchemy import text
import json
with SessionLocal() as db:
    result = {t: dict(db.execute(text('SELECT count(*) AS count, md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text, chr(91)||chr(93))) AS digest FROM '+t+' r')).mappings().one()) for t in ['responses','answers','questionnaires','import_batches']}
print(json.dumps(result, sort_keys=True))
"""
    return json.loads(docker("exec", "-T", "backend", "python", "-c", code, capture_output=True, text=True).stdout)


def main(suites):
    token = secrets.token_hex(12)
    directory = f"/tmp/savra-participation-qa-{token}"
    before = real_snapshot()
    evidence = ROOT / ".local" / f"participation-{token}.json"
    evidence.parent.mkdir(exist_ok=True)
    evidence.write_text(json.dumps({"before": before}, indent=2), encoding="utf-8")
    try:
        docker("exec", "-T", "backend", "mkdir", directory)
        docker("cp", str(ROOT / "backend") + "/.", f"backend:{directory}")
        if "backend" in suites:
            docker("exec", "-T", "-w", directory, "-e", f"PYTHONPATH={directory}", "backend", "python", "tests/run_existing_postgres.py")
        if "browser" in suites:
            env = {**os.environ, "SAVRA_QA_BACKEND": directory}
            subprocess.run(["node", "node_modules/@playwright/test/cli.js", "test", "--config=playwright.participation.config.ts"],
                           cwd=ROOT / "frontend", env=env, check=True)
    finally:
        after = real_snapshot()
        evidence.write_text(json.dumps({"before": before, "after": after, "unchanged": before == after}, indent=2), encoding="utf-8")
        # Explicit fixed-prefix path created by this run, never /app or a volume.
        docker("exec", "-T", "-u", "root", "backend", "python", "-c",
               "from pathlib import Path; import shutil,sys; p=Path(sys.argv[1]).resolve(); "
               "assert p.parent == Path('/tmp') and p.name.startswith('savra-participation-qa-'); shutil.rmtree(p)", directory)
        if before != after:
            raise RuntimeError(f"Cambió la base principal; revisar {evidence}")
        print(f"Base principal intacta. Evidencia: {evidence}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suites", choices=("backend", "browser"), nargs="+")
    main(parser.parse_args().suites)

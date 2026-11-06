"""Audit staged bytes and reachable history; findings never contain secret values."""
import argparse
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DOCS = {"docs/despliegue-render.md", "docs/migracion-neon.md", "docs/seguridad.md", "docs/preparacion-validacion.md"}
BRANDING = {"frontend/public/branding/logo_savra.png", "frontend/public/branding/isotipo_savra.png"}
TEXT_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".json", ".md", ".txt", ".yaml", ".yml", ".toml", ".ini", ".conf", ".sh", ".ps1", ".mako"}
SPECIAL_FILES = {".gitignore", ".dockerignore", ".gitattributes", ".env.example", ".env.production.example", ".gitkeep", "Dockerfile"}
TOKEN_PATTERNS = [
    re.compile(rb"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(rb"github_pat_[A-Za-z0-9_]{40,}"),
    re.compile(rb"AKIA[0-9A-Z]{16}"),
    re.compile(rb"(?:sk-proj-|sk_live_|rnd_|npg_)[A-Za-z0-9_-]{20,}"),
    re.compile(b"-----BEGIN " + rb"(?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"),
]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def path_problem(name):
    path = PurePosixPath(name)
    lower = name.lower()
    if name in BRANDING or name == "datos_originales/.gitkeep":
        return None
    if (any(part in {".local", ".venv", "node_modules", "dist", "test-results", "playwright-report", "__pycache__", "backups", "exports", "private", "secrets", "credentials"} for part in path.parts)
            or lower.startswith(("datos_originales/", "identidad visual/", "docs/capturas/"))
            or (name.startswith("docs/") and name not in PUBLIC_DOCS)):
        return "ruta privada o evidencia local"
    if path.name not in SPECIAL_FILES and path.suffix not in TEXT_EXTENSIONS:
        return "tipo de archivo no revisado"
    if path.name.startswith(".env") and path.name not in {".env.example", ".env.production.example"}:
        return "archivo de entorno privado"
    return None


def local_secret_values():
    values = []
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8-sig").splitlines():
            key, _, value = line.partition("=")
            if any(word in key.upper() for word in ("SECRET", "PASSWORD", "TOKEN", "DATABASE_URL", "PRIVATE_KEY")):
                value = value.strip().strip("\"'")
                if len(value) >= 12:
                    values.extend([value.encode(), quote(value, safe="").encode()])
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--working-tree", action="store_true", help="Revisa candidatos antes de git add")
    args = parser.parse_args()
    issues, checked = [], set()
    secrets = local_secret_values()

    def inspect(name, data, location):
        problem = path_problem(name)
        if problem:
            issues.append((location, name, problem))
        if any(value in data for value in secrets):
            issues.append((location, name, "coincide con un secreto local; valor oculto"))
        if any(pattern.search(data) for pattern in TOKEN_PATTERNS):
            issues.append((location, name, "posible token o clave privada; valor oculto"))
        if name not in BRANDING and b"\x00" in data:
            issues.append((location, name, "binario inesperado"))

    listing = (git("ls-files", "--cached", "-z") + git("ls-files", "--others", "--exclude-standard", "-z")
               if args.working_tree else git("ls-files", "--cached", "-z"))
    paths = sorted(set(filter(None, listing.decode().split("\0"))))
    for name in filter(None, paths):
        data = (ROOT / name).read_bytes() if args.working_tree else git("show", ":" + name)
        inspect(name, data, "candidato" if args.working_tree else "índice")
    if not any(paths):
        raise SystemExit("No hay archivos preparados para auditar")
    # HEAD only: preserved local branches must never be included in the first push.
    head = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=ROOT, capture_output=True)
    if head.returncode == 0:
        for commit in git("rev-list", "HEAD").decode().splitlines():
            for entry in git("ls-tree", "-rz", "--full-tree", commit).split(b"\0"):
                if not entry:
                    continue
                meta, name = entry.split(b"\t", 1)
                _, kind, oid = meta.split()
                if kind != b"blob":
                    continue
                label = name.decode("utf-8")
                key = (label, oid)
                if key not in checked:
                    inspect(label, git("cat-file", "blob", oid.decode()), "historial de HEAD")
                    checked.add(key)
    for location, name, problem in sorted(set(issues)):
        print(f"REVISAR {location}: {name}: {problem}")
    if issues:
        raise SystemExit(1)
    print(f"Auditoría correcta: {len(list(filter(None, paths)))} archivos preparados; {len(checked)} blobs históricos revisados. Sin coincidencias de secretos ni rutas privadas.")


if __name__ == "__main__":
    main()

"""Explicit administrative version selection, without importing response data."""
import argparse
from pathlib import Path
import re
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "activate"))
    parser.add_argument("version")
    args = parser.parse_args()
    try:
        from .config import get_settings
        from .database import SessionLocal
        from .questionnaires import load_definition, register_questionnaire
        if get_settings().data_mode != "real" or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", args.version):
            raise ValueError("Se requiere un instrumento real")
        path = Path(__file__).resolve().parents[1] / "configuration" / f"{args.version}.json"
        definition = load_definition(path)
        if definition.version != args.version:
            raise ValueError("La versión no coincide con el archivo")
        with SessionLocal.begin() as db:
            q = register_questionnaire(db, definition, activate=args.action == "activate")
            active = q.active
        print(f"Instrumento {args.version}: {'activo' if active else 'preparado sin activación'}. Respuestas históricas conservadas.")
    except Exception:
        print("Operación detenida. Revise versión, definición y conexión; no se muestran datos ni credenciales.", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()

import argparse
import json
from pathlib import Path
from sqlalchemy import select
from .config import get_settings
from .database import SessionLocal
from .models import ImportBatch, Questionnaire
from .processing.demo import DEFAULT_COUNT, generate_demo
from .processing.forms import batch_report, import_forms
from .questionnaires import active_questionnaire, load_definition, register_questionnaire


def main():
    parser = argparse.ArgumentParser(description="SAVRA · Administración local (sin API pública de importación)")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("bootstrap")
    register = commands.add_parser("register-questionnaire")
    register.add_argument("definition")
    importer = commands.add_parser("import-forms")
    importer.add_argument("file")
    importer.add_argument("--version", default="forms-v1")
    importer.add_argument("--expect-received", type=int)
    importer.add_argument("--expect-eligible", type=int)
    generator = commands.add_parser("generate-demo", help="Genera respuestas simuladas exclusivamente en savra_demo")
    generator.add_argument("--count", type=int, default=DEFAULT_COUNT)
    generator.add_argument("--rebuild", action="store_true", help="Reconstruye el conjunto generado dentro de savra_demo")
    commands.add_parser("imports")
    args = parser.parse_args()
    try:
        with SessionLocal.begin() as db:
            if args.command in {"bootstrap", "register-questionnaire"}:
                path = args.definition if args.command == "register-questionnaire" else get_settings().questionnaire_file
                if not Path(path).exists():
                    raise ValueError(f"No existe la definición: {path}")
                definition = load_definition(path)
                q = register_questionnaire(db, definition, activate=args.command == "register-questionnaire" or active_questionnaire(db) is None)
                output = {"version": q.version, "questions": len(q.questions), "active": q.active}
            elif args.command == "generate-demo":
                output = generate_demo(db, args.count, rebuild=args.rebuild)
            elif args.command == "import-forms":
                q = db.scalar(select(Questionnaire).where(Questionnaire.version == args.version))
                if q is None:
                    raise ValueError("Registra primero la versión del cuestionario")
                output = import_forms(db, args.file, q, args.expect_received, args.expect_eligible)
            else:
                output = [batch_report(row) for row in db.scalars(select(ImportBatch).order_by(ImportBatch.id))]
        print(json.dumps(output, ensure_ascii=False, indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()

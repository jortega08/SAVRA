"""Reproduce the initial definition from exact headers and OBSERVED choices.

This is an administrator's source extraction, not a claim that unselected Forms
choices or the original mandatory settings are recoverable from Excel.
Do not rerun over a registered version: write and register a new version instead.
"""
import argparse
import json
from pathlib import Path
import pandas as pd

KEYS = ["consent", "eligibility", "university", "age_range", "semester", "career_area", "work_hours",
        "gpa_range", "failed_courses", "absence_frequency", "economic_difficulty", "academic_load",
        "institutional_support", "motivation", "dropout_thoughts", "enrollment_likelihood", "main_difficulty", "open_comment"]
ORDERS = {
    "semester": ["Primero", "Segundo o tercero", "Cuarto o quinto", "Sexto o séptimo", "Octavo o superior"],
    "work_hours": ["No trabajo", "De 1 a 20 horas", "De 21 a 40 horas", "Más de 40 horas"],
    "failed_courses": ["Ninguna", "Una", "Dos", "Tres o más"],
    "absence_frequency": ["Nunca", "Una vez", "Dos o tres veces", "Cuatro o más veces"],
    "dropout_thoughts": ["Nunca", "Rara vez", "Algunas veces", "Frecuentemente", "Muy frecuentemente"],
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("output")
    parser.add_argument("--version", default="forms-v1")
    args = parser.parse_args()
    data = pd.read_excel(args.file, keep_default_na=False, dtype=object)
    if len(data.columns) != 24 or "Aceptas participar" not in str(data.columns[6]):
        raise SystemExit("El archivo no coincide con el instrumento inspeccionado: configure un mapeo nuevo.")
    questions = []
    for position, key in enumerate(KEYS):
        header = str(data.columns[position + 6])
        # Never inspect, copy, or persist free text in a definition.
        options = sorted({str(x) for x in data[header] if str(x).strip()}) if key != "open_comment" else []
        if key in ORDERS:
            order = ORDERS[key]
            options.sort(key=lambda x: order.index(x) if x in order else 999)
        section = "Elegibilidad" if key in {"consent", "eligibility"} else "Perfil académico" if position <= 5 else "Experiencia académica" if position <= 9 else "Contexto y permanencia" if position <= 15 else "Tu perspectiva"
        question = {"key": key, "prompt": header, "source_column": header,
                    "kind": "text" if key == "open_comment" else "category", "section": section,
                    "required": key != "open_comment", "options": options}
        if key == "consent":
            question["eligible_values"] = ["Sí, acepto"]
        elif key == "eligibility":
            question["eligible_values"] = ["Sí"]
        questions.append(question)
    definition = {"version": args.version, "title": "Factores asociados con la intención de abandono universitario",
        "source_namespace": "savra-msforms-original-v1",
        "provenance": {"origin": "Microsoft Forms · exportación local", "options_basis": "observed_in_export",
            "option_set_complete": False, "question_wording": "Exact Excel column headers; no paraphrasing",
            "required_basis": "SAVRA integrated policy: all closed questions required, final text optional; Forms settings unavailable",
            "notes": "Observed categories preserved verbatim, including whitespace. Unobserved original options require questionnaire-owner review."},
        "questions": questions}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(definition, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Definición: {len(questions)} preguntas; solo opciones observadas. No se exportaron respuestas ni metadatos personales.")


if __name__ == "__main__":
    main()

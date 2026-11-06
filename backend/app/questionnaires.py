import hashlib
import json
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session
from .config import get_settings
from .models import Option, Question, Questionnaire

DEMO_VERSION = "demo-movilidad-v1"
INTEGRATED_VERSION = "savra-integrada-v2"
DEMO_NOTICE = "DATOS SIMULADOS — DEMOSTRACIÓN TÉCNICA"


def require_demo_database(db: Session):
    if (get_settings().data_mode != "demo" or db.get_bind().dialect.name != "postgresql"
            or db.scalar(text("SELECT current_database()")) != "savra_demo"):
        raise ValueError("Esta operación requiere DATA_MODE=demo y PostgreSQL savra_demo")


class QuestionDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,99}$")
    prompt: str = Field(min_length=1, max_length=2000)
    source_column: str
    kind: str = "category"
    section: str
    required: bool = True
    options: list[str] = []
    eligible_values: list[str] | None = None

    @model_validator(mode="after")
    def validate_kind(self):
        if self.kind not in {"category", "text"}:
            raise ValueError("Tipo de pregunta no soportado")
        if self.kind == "category" and not self.options:
            raise ValueError("Una categoría requiere opciones originales")
        if len(set(self.options)) != len(self.options):
            raise ValueError("Opciones duplicadas")
        if self.eligible_values and not set(self.eligible_values) <= set(self.options):
            raise ValueError("Elegibilidad fuera de las opciones")
        return self


class Definition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    title: str
    source_namespace: str
    provenance: dict
    questions: list[QuestionDefinition]

    @model_validator(mode="after")
    def validate_questions(self):
        keys = [q.key for q in self.questions]
        if len(keys) != len(set(keys)):
            raise ValueError("Claves duplicadas")
        for key in ("consent", "eligibility"):
            question = next((q for q in self.questions if q.key == key), None)
            if not question or not question.required or not question.eligible_values or len(question.eligible_values) != 1:
                raise ValueError(f"{key}: se requiere exactamente un valor de aceptación")
        questions = {q.key: q for q in self.questions}
        for key, rule in self.provenance.get("conditional_text", {}).items():
            target, parent = questions.get(key), questions.get(rule.get("question"))
            if (not target or target.kind != "text" or target.required or not parent
                    or parent.kind != "category" or rule.get("value") not in parent.options
                    or not 1 <= rule.get("max_length", 0) <= 500):
                raise ValueError("Regla de texto condicional inválida")
        return self


def load_definition(path: str | Path) -> Definition:
    return Definition.model_validate_json(Path(path).read_text(encoding="utf-8"))


def register_questionnaire(db: Session, definition: Definition, activate=True):
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(724193602)"))
    if definition.version == DEMO_VERSION or definition.provenance.get("data_mode") == "demo":
        require_demo_database(db)
    digest = hashlib.sha256(definition.model_dump_json().encode()).hexdigest()
    existing = db.scalar(select(Questionnaire).where(Questionnaire.version == definition.version))
    if existing:
        if existing.definition_hash != digest:
            raise ValueError("Una versión registrada es inmutable. Cree una versión nueva.")
        if activate:
            db.execute(update(Questionnaire).values(active=False))
            db.flush()
            existing.active = True
        return existing
    if activate:
        db.execute(update(Questionnaire).values(active=False))
        db.flush()
    questionnaire = Questionnaire(version=definition.version, title=definition.title, active=activate,
                                  definition_hash=digest, provenance={**definition.provenance, "source_namespace": definition.source_namespace})
    for i, q in enumerate(definition.questions):
        question = Question(**q.model_dump(exclude={"options"}), position=i)
        question.options = [Option(value=value, label=value, position=j) for j, value in enumerate(q.options)]
        questionnaire.questions.append(question)
    db.add(questionnaire)
    db.flush()
    return questionnaire


def active_questionnaire(db: Session):
    return db.scalar(select(Questionnaire).where(Questionnaire.active.is_(True)))


def public_questionnaire(q: Questionnaire):
    examples = q.provenance.get("option_examples", {})
    conditional = q.provenance.get("conditional_text", {})
    return {"version": q.version, "title": q.title,
            "options_basis": q.provenance.get("options_basis"),
            **({"estimated_minutes": q.provenance["estimated_minutes"]} if "estimated_minutes" in q.provenance else {}),
            "questions": [{"key": item.key, "prompt": item.prompt, "kind": item.kind,
                           "section": item.section, "required": item.required,
                           **({"required_when": {"question": conditional[item.key]["question"], "value": conditional[item.key]["value"]},
                               "max_length": conditional[item.key]["max_length"]} if item.key in conditional else {}),
                           "options": [{"value": o.value, "label": o.label,
                                        **({"example": examples[item.key][o.value]}
                                           if o.value in examples.get(item.key, {}) else {})} for o in item.options]}
                          for item in q.questions]}


def validate_answers(questionnaire: Questionnaire, answers: dict[str, str], *, consent_from_session=False):
    questions = {q.key: q for q in questionnaire.questions}
    result = dict(answers)
    if set(result) - set(questions):
        raise ValueError("La respuesta contiene variables no definidas")
    if consent_from_session:
        result["consent"] = questions["consent"].eligible_values[0]
    for key, question in questions.items():
        value = result.get(key)
        conditional = questionnaire.provenance.get("conditional_text", {}).get(key)
        required = question.required
        if conditional:
            required = result.get(conditional["question"]) == conditional["value"]
            if not required:
                if isinstance(value, str) and value.strip():
                    raise ValueError(f"El texto no corresponde a la opción seleccionada: {key}")
                result.pop(key, None)
                continue
        if value is None or not isinstance(value, str) or not value.strip():
            if required:
                raise ValueError(f"Falta la pregunta obligatoria: {key}")
            result.pop(key, None)
            continue
        limit = conditional["max_length"] if conditional else (2000 if question.kind == "text" else 500)
        if len(value) > limit:
            raise ValueError(f"Respuesta demasiado larga: {key}")
        if question.kind == "category" and value not in {o.value for o in question.options}:
            raise ValueError(f"Opción no reconocida: {key}")
        if question.eligible_values and value not in question.eligible_values:
            raise ValueError(f"No cumple el criterio: {key}")
        if conditional:
            result[key] = value.strip()
    return result


def payload_hash(answers: dict):
    return hashlib.sha256(json.dumps(answers, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

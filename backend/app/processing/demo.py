"""Deterministic simulated records. Administrative CLI only."""
from hashlib import sha256
from itertools import batched
from pathlib import Path
from random import Random

from sqlalchemy import delete, exists, insert, select, text
from sqlalchemy.orm import Session

from ..models import Answer, ImportBatch, SurveyResponse
from ..questionnaires import DEMO_VERSION, load_definition, payload_hash, register_questionnaire, require_demo_database, validate_answers

SEED = 340513
DEFAULT_COUNT = 2500
MAX_COUNT = 100_000
DEFINITION_PATH = Path(__file__).resolve().parents[2] / "configuration" / f"{DEMO_VERSION}.json"


def synthetic_answers(count):
    rng = Random(SEED)
    questions = {q.key: q for q in load_definition(DEFINITION_PATH).questions}

    def pick(key, weights):
        return rng.choices(questions[key].options, weights=weights)[0]

    def position(key, value):
        return questions[key].options.index(value)

    for _ in range(count):
        semester = pick("semester", (24, 29, 27, 20))
        stage = position("semester", semester)
        hours = pick("work_hours", (35 - 3 * stage, 30, 22 + 2 * stage, 13 + stage))
        work = position("work_hours", hours)
        mode = pick("transport_mode", (18, 12, 31, 24, 15))
        transport = position("transport_mode", mode)
        time = pick("commute_time", (
            (44, 33, 16, 7), (37, 36, 19, 8), (16, 31, 35, 18),
            (31, 37, 22, 10), (25, 35, 26, 14),
        )[transport])
        commute = position("commute_time", time)
        yield {
            "consent": questions["consent"].eligible_values[0],
            "eligibility": questions["eligibility"].eligible_values[0],
            "university": pick("university", (16, 25, 21, 23, 15)),
            "age_range": pick("age_range", (52 - 10 * stage, 33 + 4 * stage, 10 + 4 * stage, 5 + 2 * stage)),
            "semester": semester,
            "career_area": pick("career_area", (19, 16, 10, 20, 26, 9)),
            "work_hours": hours,
            "gpa_range": pick("gpa_range", (25, 47, 28)),
            "failed_courses": pick("failed_courses", (54, 30, 16)),
            "absence_frequency": pick("absence_frequency", (37, 30, 22, 11)),
            "economic_difficulty": pick("economic_difficulty", (15, 23, 31, 19, 12)),
            "academic_load": pick("academic_load", (15 - work, 23 - work, 32, 18 + work, 12 + work)),
            "institutional_support": pick("institutional_support", (11, 18, 33, 25, 13)),
            "motivation": pick("motivation", (15, 30, 34, 21)),
            "dropout_thoughts": pick("dropout_thoughts", (32, 24, 21, 14, 9)),
            "enrollment_likelihood": pick("enrollment_likelihood", (24, 53, 20 if stage == 3 else 0, 23)),
            "main_difficulty": pick("main_difficulty", (10, 19, 11, 19, 8, 13, 14, 6)),
            "transport_mode": mode,
            "commute_time": time,
            "weekly_transport_cost": pick("weekly_transport_cost", (
                (100, 0, 0, 0), (47, 36, 13, 4), (0, 36, 45, 19),
                (0, 31, 45, 24), (0, 12, 35, 53),
            )[transport]),
            "mobility_delay": pick("mobility_delay", (36 - 5 * commute, 30, 23 + 3 * commute, 11 + 2 * commute)),
            "commute_difficulty": pick("commute_difficulty", (35 - 5 * commute, 32 - 2 * commute, 22 + 4 * commute, 11 + 3 * commute)),
        }


def fingerprint(index):
    return sha256(f"{DEMO_VERSION}:{SEED}:{index}".encode()).hexdigest()


def generate_demo(db: Session, count: int = DEFAULT_COUNT, *, rebuild: bool = False):
    require_demo_database(db)
    if not 0 <= count <= MAX_COUNT:
        raise ValueError(f"La cantidad debe estar entre 0 y {MAX_COUNT}")
    db.execute(text("SELECT pg_advisory_xact_lock(724193602)"))
    questionnaire = register_questionnaire(db, load_definition(DEFINITION_PATH))
    if (db.scalar(select(exists().where(ImportBatch.id.is_not(None))))
            or db.scalar(select(exists().where(
                (SurveyResponse.questionnaire_id != questionnaire.id)
                | (SurveyResponse.source != "integrated"))))):
        raise ValueError("La base demo contiene registros ajenos a esta simulación")

    existing = dict(db.execute(select(SurveyResponse.fingerprint, SurveyResponse.payload_hash)).all())
    expected = {fingerprint(i) for i in range(len(existing))}
    if existing.keys() != expected:
        raise ValueError("La base demo contiene registros que no pertenecen al generador")
    if rebuild:
        # FK cascade removes the corresponding answers in this transaction.
        db.execute(delete(SurveyResponse).where(SurveyResponse.questionnaire_id == questionnaire.id))
        existing.clear()
    elif count < len(existing):
        raise ValueError("Para reducir la cantidad, ejecuta generate-demo con --rebuild")

    question_ids = {q.key: q.id for q in questionnaire.questions}
    for batch in batched(enumerate(synthetic_answers(count)), 500):
        rows = []
        by_fingerprint = {}
        for index, answers in batch:
            key = fingerprint(index)
            values = validate_answers(questionnaire, answers)
            digest = payload_hash(values)
            if key in existing:
                if existing[key] != digest:
                    raise ValueError("El contenido generado cambió. Usa --rebuild en la base demo")
                continue
            rows.append(dict(questionnaire_id=questionnaire.id, source="integrated", fingerprint=key, payload_hash=digest))
            by_fingerprint[key] = values
        if rows:
            response_ids = db.execute(insert(SurveyResponse).returning(SurveyResponse.id, SurveyResponse.fingerprint), rows)
            db.execute(insert(Answer), [
                dict(response_id=response_id, question_id=question_ids[key], value=value)
                for response_id, row_key in response_ids for key, value in by_fingerprint[row_key].items()
            ])
    return {"data_mode": "demo", "version": DEMO_VERSION, "seed": SEED, "total": count,
            "newly_stored": count - len(existing), "rebuild": rebuild}

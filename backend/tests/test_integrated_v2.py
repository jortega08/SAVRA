import hashlib
from pathlib import Path

import pytest
from sqlalchemy import select

from app.analytics import compatible_questions
from app.models import Answer, Question, Questionnaire, SurveyResponse
from app.questionnaires import active_questionnaire, load_definition, register_questionnaire, validate_answers
from test_analytics import seed

CONFIGURATION = Path(__file__).resolve().parents[1] / "configuration"
NEW = load_definition(CONFIGURATION / "savra-integrada-v2.json")
AREAS = next(q for q in NEW.questions if q.key == "career_area").options


def valid_answers(q):
    return {item.key:(item.eligible_values or [option.value for option in item.options])[0]
            for item in q.questions if item.kind == "category"}


def test_new_version_preserves_all_other_questions_and_eligibility():
    assert hashlib.sha256((CONFIGURATION / "forms-v1.json").read_bytes()).hexdigest() == "e4ea3c50348124ac6b16a9d26d4dbaae7615484fdcd9404ce42dae576bf47e0e"
    original = load_definition(CONFIGURATION / "forms-v1.json")
    assert len(NEW.questions) == 27 and len(original.questions) == 18
    assert NEW.provenance["primary_question_count"] == 24
    assert NEW.version == "savra-integrada-v2"
    by_key = {q.key:q for q in NEW.questions}
    for old in original.questions:
        new=by_key[old.key]
        if old.key not in {"career_area","gpa_range","failed_courses","main_difficulty","semester"}:
            assert old.model_dump(exclude={"section"}) == new.model_dump(exclude={"section"})
        assert old.required == new.required and old.eligible_values == new.eligible_values
    assert [q.section for q in NEW.questions if q.key == "eligibility"] == ["Elegibilidad"]
    assert len(AREAS) == 12
    assert AREAS[-2:] == ["Otra área / No encuentro mi carrera", "No estoy seguro(a)"]
    compatibility = NEW.provenance["analytics_compatibility"]
    assert len(compatibility) == 13 and "career_area" not in compatibility
    assert NEW.provenance["category_compatibility"]["career_area"]["mapping"] == {}
    examples = NEW.provenance["option_examples"]["career_area"]
    assert set(examples) == set(AREAS)
    assert "Biología" in examples[AREAS[4]]
    assert "Medicina Veterinaria" in examples[AREAS[7]]


@pytest.mark.parametrize("area", AREAS)
def test_all_areas_are_eligible_save_once_and_never_recode_history(client, db, questionnaire, answers, area):
    current = register_questionnaire(db, load_definition(CONFIGURATION / "savra-integrada-v2.json"))
    db.commit()
    assert client.post("/api/participation/start", json={"accepted": True, "questionnaire_version": current.version}).status_code == 200
    public = client.get("/api/questionnaire").json()
    public_area = next(q for q in public["questions"] if q["key"] == "career_area")
    assert [o["value"] for o in public_area["options"]] == AREAS
    assert all(o["example"] for o in public_area["options"])
    body = {"questionnaire_version": current.version, "answers": {**valid_answers(current), "career_area": area}}
    for _ in range(2):
        assert client.post("/api/responses", json=body).json() == {"saved": True}
    stored = list(db.scalars(select(SurveyResponse)))
    assert len(stored) == 1 and stored[0].questionnaire_id == current.id
    assert db.scalar(select(Answer.value).join(Question).where(Question.key == "career_area")) == area
    assert len(list(db.scalars(select(Answer)))) == 23


def test_prepare_activate_and_analytics_preserve_historical_rows(client, db, questionnaire, answers):
    seed(db, questionnaire, answers, count=20)
    original_responses = db.execute(SurveyResponse.__table__.select().order_by(SurveyResponse.id)).all()
    original_answers = db.execute(Answer.__table__.select().order_by(Answer.id)).all()
    original_questions = db.execute(Question.__table__.select().order_by(Question.id)).all()
    original_definition = (questionnaire.definition_hash, dict(questionnaire.provenance), questionnaire.version)
    current = register_questionnaire(db, load_definition(CONFIGURATION / "savra-integrada-v2.json"), activate=False)
    db.commit()
    assert active_questionnaire(db).id == questionnaire.id and not current.active
    register_questionnaire(db, load_definition(CONFIGURATION / "savra-integrada-v2.json"), activate=True)
    db.commit()
    assert active_questionnaire(db).id == current.id
    assert db.execute(SurveyResponse.__table__.select().order_by(SurveyResponse.id)).all() == original_responses
    assert db.execute(Answer.__table__.select().order_by(Answer.id)).all() == original_answers
    assert db.execute(Question.__table__.select().where(Question.questionnaire_id == questionnaire.id).order_by(Question.id)).all() == original_questions
    assert (questionnaire.definition_hash, questionnaire.provenance, questionnaire.version) == original_definition
    # A new integrated record contributes only through proven unchanged variables.
    assert client.post("/api/participation/start", json={"accepted": True, "questionnaire_version": current.version}).status_code == 200
    result = client.post("/api/responses", json={"questionnaire_version": current.version, "answers": {**valid_answers(current), "career_area": AREAS[-2]}})
    assert result.status_code == 200
    ids = compatible_questions(db)
    for q in current.questions:
        if q.key in ids:
            assert q.id in ids[q.key]
    assert client.get("/api/overview").json()["eligible_responses"] == 21
    for module in ("academic", "permanence", "institutional", "quality", "methodology"):
        response = client.get(f"/api/analytics/{module}")
        assert response.status_code == 200
        assert response.json()["eligible_responses"] == 21
        assert all(chart["status"] in {"ready","insufficient","unavailable"} for chart in response.json()["charts"])
    assert db.execute(Answer.__table__.select().where(Answer.id.in_([r.id for r in original_answers])).order_by(Answer.id)).all() == original_answers


CATALOGUE_KEYS = {"gpa_range","failed_courses","main_difficulty","relocated_for_study","transport_mode","commute_time","weekly_transport_cost","mobility_delay","preferred_support"}


@pytest.mark.parametrize("key,value", [(q.key,value) for q in NEW.questions if q.key in CATALOGUE_KEYS for value in q.options])
def test_complete_catalogues_accept_every_declared_option(db,key,value):
    q=register_questionnaire(db,load_definition(CONFIGURATION / "savra-integrada-v2.json"))
    values={**valid_answers(q),key:value}
    for field,rule in NEW.provenance["conditional_text"].items():
        if values[rule["question"]]==rule["value"]:
            values[field]="Detalle de prueba, exclusivamente aislado."
    assert validate_answers(q,values)[key]==value


@pytest.mark.parametrize("field,rule", list(NEW.provenance["conditional_text"].items()))
def test_other_text_is_required_only_when_selected_and_bounded(db,field,rule):
    q=register_questionnaire(db,load_definition(CONFIGURATION / "savra-integrada-v2.json"))
    base=valid_answers(q)
    selected={**base,rule["question"]:rule["value"]}
    for value in (None,"   ","x"*301):
        with pytest.raises(ValueError): validate_answers(q,{**selected,field:value})
    result=validate_answers(q,{**selected,field:"  Texto restringido de prueba.  "})
    assert result[field]=="Texto restringido de prueba."
    assert field not in validate_answers(q,base)
    with pytest.raises(ValueError): validate_answers(q,{**base,field:"Texto residual que no corresponde"})


def test_new_student_can_submit_without_prior_grades_or_failed_courses(client,db):
    q=register_questionnaire(db,load_definition(CONFIGURATION / "savra-integrada-v2.json")); db.commit()
    values={**valid_answers(q),"gpa_range":"No aplica: aún no tengo promedio","failed_courses":"No aplica: aún no he finalizado un semestre"}
    client.post("/api/participation/start",json={"accepted":True,"questionnaire_version":q.version})
    assert client.post("/api/responses",json={"questionnaire_version":q.version,"answers":values}).status_code==200


def test_gpa_intervals_remain_categories_with_proven_legacy_mapping(db,questionnaire,answers):
    from app.analytics import Context
    seed(db,questionnaire,answers,count=20)
    q=register_questionnaire(db,load_definition(CONFIGURATION / "savra-integrada-v2.json")); db.commit()
    context=Context(db)
    assert context.frequencies("gpa_range").full=={"3,0 a 3,4":20}
    assert db.scalar(select(Answer.value).join(Question).where(Question.key=="gpa_range"))=="De 3,0 a 3,4"
    options=next(item for item in NEW.questions if item.key=="gpa_range").options
    assert options==["0,0 a 2,9","3,0 a 3,4","3,5 a 3,9","4,0 a 4,4","4,5 a 5,0","No aplica: aún no tengo promedio"]

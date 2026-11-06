from pathlib import Path

from sqlalchemy import select

from app.analytics import Context, REAL_MOBILITY_KEYS, module_data
from app.models import Answer, Question
from app.questionnaires import load_definition, register_questionnaire, validate_answers
from test_analytics import seed
from test_integrated_v2 import valid_answers
from test_phase2 import insert


def new_instrument(db):
    return register_questionnaire(db, load_definition(Path(__file__).resolve().parents[1] / "configuration/savra-integrada-v2.json"))


def seed_new(db, q, count=20):
    by_key = {item.key: item for item in q.questions}
    for i in range(count):
        group = i % 2
        values = {**valid_answers(q), "university": by_key["university"].options[group].value,
                  "relocated_for_study": "Sí" if group == 0 else "No",
                  "transport_mode": "Caminando" if group == 0 else "Transporte público: bus, buseta o colectivo",
                  "commute_time": "Hasta 15 minutos" if group == 0 else "De 31 a 60 minutos"}
        insert(db, q, validate_answers(q, values), f"integrated-new-{i}")
    db.commit()


def test_real_mobility_has_only_new_coverage_and_safe_matrices(db, questionnaire, answers):
    seed(db, questionnaire, answers, count=20)
    q = new_instrument(db)
    seed_new(db, q)
    data = module_data(db, "academic")
    assert data["eligible_responses"] == 40
    mobility = data["mobility"]
    assert mobility["status"] == "ready"
    assert {c["key"] for c in mobility["charts"]} == set(REAL_MOBILITY_KEYS)
    for chart in mobility["charts"]:
        assert chart["introduced_in"] == q.version
        assert chart["status"] == "ready"
        assert chart["denominator"] == chart["missing"] == 20
        assert chart["coverage_percentage"] == 50
    for chart in [mobility["flow"], *mobility["comparisons"]]:
        assert chart["status"] == "ready"
        assert chart["denominator"] == 20 and chart["missing"] == 20
        assert sum(cell["count"] for cell in chart["data"]) == 20
        assert all(cell["count"] == 0 or cell["count"] >= 5 for cell in chart["data"])
    ctx = Context(db)
    for u in (None, *ctx.allowed["university"]):
        filtered = module_data(db, "academic", university=u)
        assert filtered["eligible_responses"] == (40 if u is None else 20)
        assert filtered["mobility"]["flow"]["denominator"] == (20 if u is None else 10)
    old_ids = [item.id for item in questionnaire.questions]
    assert not any(key in {item.key for item in questionnaire.questions} for key in REAL_MOBILITY_KEYS)
    assert len(list(db.scalars(select(Answer.id).where(Answer.question_id.in_(old_ids))))) == 360


def test_small_new_cohort_never_exposes_mobility_cells(db, questionnaire, answers):
    seed(db, questionnaire, answers, count=20)
    q = new_instrument(db)
    seed_new(db, q, count=4)
    mobility = module_data(db, "academic")["mobility"]
    for chart in [*mobility["charts"], mobility["flow"], *mobility["comparisons"]]:
        assert chart["status"] != "ready" and chart["data"] == []
        assert chart["denominator"] is None and chart["missing"] is None


def test_cross_version_subtraction_cannot_reveal_small_legacy_margin(db, questionnaire, answers):
    # A public matrix for v2 must not isolate the single historical "Nunca".
    for i in range(20):
        insert(db, questionnaire, {**answers, "dropout_thoughts": "Nunca" if i == 0 else "Rara vez"}, f"legacy-residual-{i}")
    q = new_instrument(db)
    seed_new(db, q)
    chart = module_data(db, "academic")["mobility"]["comparisons"][0]
    assert chart["status"] == "insufficient" and chart["data"] == []
    assert chart["denominator"] is None


def test_mobility_flow_withholds_small_legacy_complement_in_a_public_filter(db, questionnaire, answers):
    universities = next(q for q in questionnaire.questions if q.key == "university").options
    for i in range(20):
        insert(db, questionnaire, {**answers, "university": universities[0 if i == 0 else 1].value}, f"legacy-filter-{i}")
    q = new_instrument(db)
    for i in range(10):
        values = {**valid_answers(q), "semester": answers["semester"], "university": universities[i % 2].value}
        insert(db, q, validate_answers(q, values), f"new-filter-{i}")
    db.commit()
    ctx = Context(db)
    assert universities[0].value in ctx.allowed["university"]
    for u in (None, *ctx.allowed["university"]):
        flow = module_data(db, "academic", university=u)["mobility"]["flow"]
        assert flow["status"] == "insufficient" and flow["data"] == []
        assert flow["denominator"] is None


def test_open_other_fields_never_appear_in_public_analysis(client, db):
    q = new_instrument(db)
    marker = "RESTRICTED_CONDITIONAL_TEXT_NEVER_PUBLISH"
    values = valid_answers(q)
    for key, rule in q.provenance["conditional_text"].items():
        values[rule["question"]] = rule["value"]
        values[key] = marker
    values["open_comment"] = marker
    for i in range(10):
        insert(db, q, validate_answers(q, values), f"private-other-{i}")
    db.commit()
    assert db.scalar(select(Answer.value).join(Question).where(Question.key == "main_difficulty_other")) == marker
    for path in ["/api/overview", *[f"/api/analytics/{key}" for key in ("academic", "permanence", "institutional", "quality", "methodology")]]:
        response = client.get(path)
        assert response.status_code == 200
        body = response.text
        assert marker not in body and "_other" not in body and "open_comment" not in body

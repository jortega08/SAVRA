from collections import Counter
import pytest
from sqlalchemy import select
from app.analytics import overview, safe_categories
from app.models import Answer, SurveyResponse
from app.questionnaires import payload_hash


def seed(db, questionnaire, answers, count=20, crossed=False):
    by_key = {q.key: q for q in questionnaire.questions}
    universities = by_key["university"].options
    for i in range(count):
        values = dict(answers)
        values["university"] = universities[0 if i < 10 else 1].value
        if crossed:
            values["semester"] = by_key["semester"].options[0 if i < 8 or 10 <= i < 12 else 1].value
        values["open_comment"] = "PRIVATE_OPEN_RESPONSE_MUST_NEVER_BE_PUBLIC"
        row = SurveyResponse(questionnaire_id=questionnaire.id, source="integrated", fingerprint=f"{i:064}", payload_hash=payload_hash(values))
        db.add(row); db.flush()
        db.add_all([Answer(response_id=row.id, question_id=by_key[key].id, value=value) for key, value in values.items()])
    db.commit()


def test_empty_state(db):
    assert overview(db)["status"] == "empty"


def test_suppression_secondary_and_denominators():
    data, pooled = safe_categories([("A", 20), ("B", 2)], 5)
    assert pooled and data == [("Otras categorías · agrupadas por privacidad", 22)]
    data, pooled = safe_categories([("A", 2), ("B", 1)], 5)
    assert not data and pooled
    data, _ = safe_categories([("A", 10), ("B", 3), ("C", 4)], 5)
    assert dict(data)["Otras categorías · agrupadas por privacidad"] == 7
    data, _ = safe_categories([("A", 10), ("B", 4), ("C", 4)], 5)
    assert data == [("Otras categorías · agrupadas por privacidad", 18)]


def test_sql_aggregates_filters_privacy(client, db, questionnaire, answers):
    seed(db, questionnaire, answers)
    data = client.get("/api/overview").json()
    assert data["eligible_responses"] == 20 and data["universities"] == 2
    assert "PRIVATE_OPEN_RESPONSE" not in str(data)
    for chart in data["charts"]:
        assert chart["denominator"] == 20
        assert sum(d["count"] for d in chart["data"]) == 20
        assert all(d["count"] == 0 or d["count"] >= 5 for d in chart["data"])
        assert abs(sum(d["percentage"] for d in chart["data"]) - 100) < 0.5
    filtered = client.get("/api/overview", params={"university": data["filters"]["university"][0]}).json()
    assert filtered["eligible_responses"] == 10
    assert all(chart["denominator"] == 10 for chart in filtered["charts"])
    assert client.get("/api/overview?university=nonexistent").status_code == 422


def test_small_sample_hides_counts_and_graphs(db, questionnaire, answers):
    seed(db, questionnaire, answers, count=3)
    data = overview(db)
    assert data["status"] == "insufficient"
    assert data["eligible_responses"] is None and data["universities"] is None
    assert data["charts"] and all(c["ordered_categories"] and not c["data"] and c["denominator"] is None for c in data["charts"])


def test_first_safe_distribution_keeps_original_options_and_zero(db, questionnaire, answers):
    seed(db, questionnaire, answers, count=5)
    chart = overview(db)["charts"][0]
    assert chart["status"] == "ready" and chart["denominator"] == 5
    assert [d["label"] for d in chart["data"]] == chart["ordered_categories"]
    assert sorted(d["count"] for d in chart["data"]) == [0, 0, 0, 0, 5]


def test_small_complement_filter_is_not_exposed(db, questionnaire, answers):
    seed(db, questionnaire, answers, count=12)
    data = overview(db)
    assert data["filters"]["university"] == []


def test_related_queries_cannot_reconstruct_small_intersections(db, questionnaire, answers):
    seed(db, questionnaire, answers, crossed=True)
    university = next(q for q in questionnaire.questions if q.key == "university").options[0].value
    semester_options = next(q for q in questionnaire.questions if q.key == "semester").options
    # Previously 10 (margin) - 8 (intersection) revealed the hidden cell of 2.
    # The fixed public partition now withholds that axis in EVERY module.
    base = overview(db)
    assert not base["filters"]["semester"]
    for semester in semester_options[:2]:
        with pytest.raises(ValueError):
            overview(db, university, semester.value)
    for university in base["filters"]["university"]:
        safe = overview(db, university=university)
        assert safe["eligible_responses"] == 10
        semester_chart = next(c for c in safe["charts"] if c["key"] == "semester")
        assert semester_chart["data"] == [] and semester_chart["denominator"] is None

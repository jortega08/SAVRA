"""Fixtures live only in transactional test DBs; never use the real stack."""
from pathlib import Path
from itertools import product

import pytest
from sqlalchemy import delete, func, select
from app.analytics import Context, module_data, overview
from app.models import Answer, Question, SurveyResponse
from app.questionnaires import load_definition, payload_hash, register_questionnaire
from test_analytics import seed


def insert(db, q, values, token):
    row = SurveyResponse(questionnaire_id=q.id, source="integrated", fingerprint=f"phase2-{token}", payload_hash=payload_hash(values))
    db.add(row); db.flush()
    by_key = {question.key: question.id for question in q.questions}
    db.add_all(Answer(response_id=row.id, question_id=by_key[key], value=value) for key, value in values.items())
    db.flush()


def balanced(db, q, answers):
    by_key = {question.key: question for question in q.questions}
    # 16 atomic combinations, 5 per cell. Original categories, no continuous data.
    for i, indices in enumerate(product(range(2), repeat=4)):
        values = dict(answers)
        for key, index in zip(("university", "semester", "motivation", "dropout_thoughts"), indices):
            values[key] = by_key[key].options[index].value
        values["open_comment"] = "NEVER_PUBLISH_THIS_COMMENT"
        for j in range(5):
            insert(db, q, values, f"balanced-{i}-{j}")
    db.commit()


@pytest.mark.parametrize("module", ["academic", "permanence", "institutional", "quality", "methodology"])
def test_modules_empty_without_errors(client, module):
    response = client.get(f"/api/analytics/{module}")
    assert response.status_code == 200
    assert response.json()["status"] == "empty"
    assert all(c["category_catalog"] and not c["data"] for c in response.json()["charts"])


def test_all_modules_real_aggregates_and_contracts(client, db, questionnaire, answers):
    balanced(db, questionnaire, answers)
    for module, expected in (("academic", 7), ("permanence", 9), ("institutional", 6)):
        data = client.get(f"/api/analytics/{module}").json()
        assert data["eligible_responses"] == 80
        assert len(data["charts"]) == expected
        serialized = str(data)
        for private in ("NEVER_PUBLISH_THIS_COMMENT", "open_comment", "fingerprint", "payload_hash", "response_id"):
            assert private not in serialized
        for chart in data["charts"]:
            assert chart["required_variables"] and chart["variable_types"]
            assert chart["minimum_group_size"] == 5
            assert chart["status"] == "ready"
            assert chart["denominator"] == 80
            assert sum(item["count"] for item in chart["data"]) == 80
            assert all(item["count"] == 0 or item["count"] >= 5 for item in chart["data"])
            if chart["kind"] == "matrix":
                for label in chart["rows"]:
                    row = [item for item in chart["data"] if item["label"] == label]
                    assert sum(item["count"] for item in row) == row[0]["row_denominator"]
                    assert abs(sum(item["percentage"] for item in row) - 100) < .5
    assert client.get('/api/analytics/unknown').status_code == 404
    assert client.get('/api/analytics/academic', params={"university": "x" * 501}).status_code == 422


def test_every_permitted_filter_combination_protects_residuals(db, questionnaire, answers):
    balanced(db, questionnaire, answers)
    base = overview(db)
    for u, s in product([None, *base["filters"]["university"]], [None, *base["filters"]["semester"]]):
        for module in ("academic", "permanence", "institutional", "quality", "methodology"):
            data = module_data(db, module, u, s)
            expected = 80 // (2 if u else 1) // (2 if s else 1)
            assert data["eligible_responses"] == expected
            for chart in data["charts"]:
                assert chart["status"] == "ready" and chart["denominator"] == expected
                assert sum(item["count"] for item in chart["data"]) == expected
    assert all(n >= 5 for n in Context(db).partition_totals.values())


def test_small_cross_cell_withholds_whole_table_and_margins(db, questionnaire, answers):
    seed(db, questionnaire, answers, count=12)
    data = module_data(db, "institutional")
    assert data["charts"][1]["status"] == "insufficient"
    for chart in data["charts"][1:]:
        assert chart["data"] == [] and chart["rows"] == [] and chart["columns"] == []
        assert chart["denominator"] is None and chart["missing"] is None


def test_same_pool_across_modules_and_no_rule_unpools_categories(db, questionnaire, answers):
    by_key = {q.key: q for q in questionnaire.questions}
    for i in range(20):
        values = dict(answers)
        values["economic_difficulty"] = by_key["economic_difficulty"].options[4 if i < 2 else 0].value
        insert(db, questionnaire, values, f"pool-{i}")
    data = module_data(db, "permanence")
    indicator = next(i for i in data["indicators"] if i["key"] == "economic_difficulty")
    assert indicator["status"] == "insufficient" and indicator["count"] is None
    chart = next(c for c in data["charts"] if c["key"] == "economic_difficulty")
    assert chart["status"] == "insufficient" and not chart["data"] and chart["category_catalog"]
    overview_chart = next(c for c in overview(db)["charts"] if c["key"] == "dropout_thoughts")
    permanence_chart = next(c for c in data["charts"] if c["key"] == "dropout_thoughts")
    assert overview_chart == permanence_chart


def test_transparent_derived_rule_and_denominator(db, questionnaire, answers):
    by_key = {q.key: q for q in questionnaire.questions}
    for i in range(20):
        values = dict(answers)
        values["economic_difficulty"] = by_key["economic_difficulty"].options[4 if i < 10 else 0].value
        insert(db, questionnaire, values, f"rule-{i}")
    indicator = module_data(db, "permanence")["indicators"][0]
    assert indicator["status"] == "ready" and indicator["count"] == 10
    assert indicator["denominator"] == 20 and indicator["percentage"] == 50
    assert "4 - Bastante dificultad" in indicator["rule"]


def test_missing_variable_and_small_missing_coverage(db, questionnaire, answers):
    seed(db, questionnaire, answers)
    motivation = next(q for q in questionnaire.questions if q.key == "motivation")
    answer_id = db.scalar(select(Answer.id).where(Answer.question_id == motivation.id))
    db.execute(delete(Answer).where(Answer.id == answer_id)); db.flush()
    data = module_data(db, "quality")
    coverage = next(q for q in data["quality"] if q["key"] == "motivation")
    assert coverage["status"] == "insufficient" and coverage["valid"] is None and coverage["missing"] is None
    chart = next(c for c in module_data(db, "academic")["charts"] if c["key"].startswith("motivation"))
    assert chart["status"] == "insufficient" and chart["denominator"] is None
    db.execute(delete(Answer).where(Answer.question_id == motivation.id))
    db.delete(motivation); db.flush()
    chart = module_data(db, "academic")["charts"][0]
    assert chart["status"] == "unavailable" and chart["data"] == []


def test_partial_coverage_uses_valid_denominator_without_imputation(db, questionnaire, answers):
    seed(db, questionnaire, answers)
    motivation = next(q for q in questionnaire.questions if q.key == "motivation")
    ids = list(db.scalars(select(Answer.id).where(Answer.question_id == motivation.id).limit(5)))
    db.execute(delete(Answer).where(Answer.id.in_(ids))); db.flush()
    chart = next(c for c in overview(db)["charts"] if c["key"] == "motivation")
    assert chart["status"] == "ready" and chart["denominator"] == 15 and chart["missing"] == 5
    assert sum(d["count"] for d in chart["data"]) == 15 and chart["coverage_percentage"] == 75
    coverage = next(q for q in module_data(db, "quality")["quality"] if q["key"] == "motivation")
    assert coverage["valid"] == 15 and coverage["coverage_percentage"] == 75


def test_empty_filter_atom_does_not_block_other_publishable_coverage(db, questionnaire, answers):
    seed(db, questionnaire, answers)
    ctx = Context(db)
    first, second = ctx.allowed["university"]
    valid_university = next(q for q in questionnaire.questions if q.key == "university")
    motivation = next(q for q in questionnaire.questions if q.key == "motivation")
    uncovered = select(Answer.response_id).where(Answer.question_id == valid_university.id, Answer.value == first)
    db.execute(delete(Answer).where(Answer.question_id == motivation.id, Answer.response_id.in_(uncovered)))
    db.flush()
    empty = next(c for c in overview(db, university=first)["charts"] if c["key"] == "motivation")
    ready = next(c for c in overview(db, university=second)["charts"] if c["key"] == "motivation")
    assert empty["status"] == "unavailable" and empty["data"] == []
    assert ready["status"] == "ready" and ready["denominator"] == 10 and ready["filterable"]


def test_pair_with_same_partial_coverage_preserves_original_categories(db, questionnaire, answers):
    seed(db, questionnaire, answers)
    ids = [q.id for q in questionnaire.questions if q.key in ("motivation", "dropout_thoughts")]
    responses = list(db.scalars(select(SurveyResponse.id).order_by(SurveyResponse.id).limit(5)))
    db.execute(delete(Answer).where(Answer.question_id.in_(ids), Answer.response_id.in_(responses)))
    db.flush()
    chart = module_data(db, "academic")["charts"][0]
    assert chart["status"] == "ready" and chart["denominator"] == 15 and chart["missing"] == 5
    assert chart["coverage_percentage"] == 75 and not chart["grouping_rules"]
    assert [cell["count"] for cell in chart["data"]] == [15, 0, 0, 0, 0]


@pytest.mark.parametrize("mapping,changed,expected", [(False, False, 20), (True, False, 30), (True, True, 20)])
def test_versions_require_explicit_semantic_compatibility(db, questionnaire, answers, mapping, changed, expected):
    seed(db, questionnaire, answers)
    before = db.scalar(select(func.count()).select_from(Answer))
    definition = load_definition(Path(__file__).resolve().parents[1] / "configuration/forms-v1.json")
    definition.version = "forms-v2"
    if mapping:
        definition.provenance["analytics_compatibility"] = {q.key: f"forms-v1:{q.key}" for q in definition.questions}
    if changed:
        next(q for q in definition.questions if q.key == "motivation").prompt = "Otra medición no equivalente"
    second = register_questionnaire(db, definition)
    for i in range(10):
        insert(db, second, answers, f"v2-{i}")
    data = overview(db)
    chart = next(c for c in data["charts"] if c["key"] == "motivation")
    assert chart["denominator"] == expected
    assert chart["missing"] == 30 - expected
    assert data["eligible_responses"] == 30
    assert db.scalar(select(func.count()).select_from(Answer).where(Answer.question_id.in_([q.id for q in questionnaire.questions]))) == before


def test_new_response_refreshes_aggregates_without_static_counts(db, questionnaire, answers):
    seed(db, questionnaire, answers)
    assert overview(db)["eligible_responses"] == 20
    insert(db, questionnaire, answers, "new")
    assert overview(db)["eligible_responses"] == 21


def test_explicit_coarsening_uses_original_categories_and_correct_row_bases(db, questionnaire, answers):
    questions = {q.key: q for q in questionnaire.questions}
    i = 0
    for motivation, counts in enumerate(((2, 1, 7), (8, 1, 1), (2, 1, 7), (8, 1, 1))):
        for thoughts, n in enumerate(counts):
            for _ in range(n):
                values = {**answers, "motivation": questions["motivation"].options[motivation].value,
                          "dropout_thoughts": questions["dropout_thoughts"].options[thoughts].value}
                insert(db, questionnaire, values, f"coarsening-{i}"); i += 1
    chart = module_data(db, "academic")["charts"][0]
    assert chart["status"] == "ready" and chart["denominator"] == 40
    assert len(chart["rows"]) == 2 and len(chart["columns"]) == 2
    assert chart["grouping_rules"] and chart["grouping_note"]
    assert all(d["count"] == 10 and d["row_denominator"] == 20 and d["percentage"] == 50 for d in chart["data"])


def test_coarsening_must_not_split_a_suppressed_pool(db, questionnaire, answers):
    questions = {q.key: q for q in questionnaire.questions}
    i = 0
    # The global motivation pool contains categories on BOTH sides of the
    # proposed grouping. Releasing the grouped matrix would disclose its parts.
    for motivation, cells in enumerate(((1, 1), (6, 6), (2, 3), (11, 10))):
        for thoughts, n in enumerate(cells):
            for _ in range(n):
                values = {**answers, "motivation": questions["motivation"].options[motivation].value,
                          "dropout_thoughts": questions["dropout_thoughts"].options[thoughts].value}
                insert(db, questionnaire, values, f"no-unpool-{i}"); i += 1
    chart = module_data(db, "academic")["charts"][0]
    assert chart["status"] == "insufficient" and chart["data"] == []
    assert chart["denominator"] is None


def test_filter_totals_cannot_unpool_secondary_categories(client, db, questionnaire, answers):
    universities = next(q for q in questionnaire.questions if q.key == "university").options
    for index, n in enumerate((25, 8, 4)):
        for i in range(n):
            insert(db, questionnaire, {**answers, "university": universities[index].value}, f"secondary-filter-{index}-{i}")
    data = overview(db)
    assert data["filters"]["university"] == [universities[0].value]
    chart = next(c for c in data["charts"] if c["key"] == "university")
    assert sorted(d["count"] for d in chart["data"]) == [0, 12, 25]
    assert data["universities"] is None
    # Publishing a filtered base of 8 would reveal 4 from the public pool of 12.
    for route in ("/api/overview", "/api/analytics/academic", "/api/analytics/institutional", "/api/analytics/quality"):
        assert client.get(route, params={"university": universities[1].value}).status_code == 422


def test_quality_does_not_disclose_one_integrated_source(client, db, questionnaire, answers):
    seed(db, questionnaire, answers)
    data = client.get('/api/analytics/quality').json()
    assert data["received_responses"] is None
    assert "source_counts" not in data
    assert all(q["valid"] == 20 and q["coverage_percentage"] == 100 for q in data["quality"])


@pytest.mark.parametrize("size", [1, 4])
def test_small_selection_all_modules_without_statistics(db, questionnaire, answers, size):
    seed(db, questionnaire, answers, count=size)
    for module in ("academic", "permanence", "institutional", "quality", "methodology"):
        data = module_data(db, module)
        assert data["status"] == "insufficient"
        assert data["eligible_responses"] is None and data["quality"] == [] and data["indicators"] == []
        assert all(c["category_catalog"] and not c["data"] and c["denominator"] is None for c in data["charts"])

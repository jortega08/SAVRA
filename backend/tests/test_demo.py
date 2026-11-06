from collections import Counter

import pytest
from sqlalchemy import func, select

from app import questionnaires
from app.analytics import MOBILITY_TITLES, module_data, overview
from app.config import get_settings
from app.models import SurveyResponse
from app.processing.demo import DEFINITION_PATH, generate_demo, synthetic_answers
from app.processing.forms import import_forms
from app.questionnaires import DEMO_VERSION, load_definition, register_questionnaire, validate_answers
from test_phase2 import insert


def test_fixed_seed_and_categorical_consistency():
    first = list(synthetic_answers(2500))
    assert len(first) == 2500 and first == list(synthetic_answers(2500))
    assert first[:37] == list(synthetic_answers(37))
    definition = load_definition(DEFINITION_PATH)
    questions = {q.key: q for q in definition.questions}
    assert len(questions["university"].options) == 5
    assert min(Counter(row["university"] for row in first).values()) > 100
    assert len({row["university"] for row in first}) == 5
    assert not any("open_comment" in row for row in first)
    for row in first:
        assert row.keys() == questions.keys()
        assert all(value in questions[key].options for key, value in row.items())
        if row["transport_mode"] == "A pie":
            assert row["weekly_transport_cost"] == "Sin costo"
        if row["enrollment_likelihood"].startswith("No aplica"):
            assert row["semester"] == "Octavo o superior"


def test_generation_and_demo_registration_refuse_non_demo_db(db, questionnaire, monkeypatch):
    definition = load_definition(DEFINITION_PATH)
    for rebuild in (False, True):
        with pytest.raises(ValueError, match="PostgreSQL savra_demo"):
            generate_demo(db, 0, rebuild=rebuild)
    with pytest.raises(ValueError, match="PostgreSQL savra_demo"):
        register_questionnaire(db, definition)
    monkeypatch.setattr(get_settings(), "data_mode", "demo")
    with pytest.raises(ValueError, match="PostgreSQL savra_demo"):
        generate_demo(db)
    with pytest.raises(ValueError, match="entorno y un instrumento de recolección"):
        import_forms(db, "nunca-leer.xlsx", questionnaire)
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 0


def test_demo_mobility_mixed_coverage_and_privacy(db, questionnaire, answers, monkeypatch):
    # Inject instrument metadata only into the rollbackable test fixture.
    # The actual administrative writer remains guarded and is verified in Docker.
    monkeypatch.setattr(questionnaires, "require_demo_database", lambda _: None)
    demo = register_questionnaire(db, load_definition(DEFINITION_PATH), activate=False)
    assert demo.version == DEMO_VERSION and questionnaire.active
    assert module_data(db, "academic")["mobility"]["status"] == "unavailable"

    monkeypatch.setattr(get_settings(), "data_mode", "demo")
    for i, row in enumerate(synthetic_answers(3)):
        insert(db, demo, validate_answers(demo, row), f"few-demo-{i}")
    protected = module_data(db, "academic")["mobility"]
    assert protected["status"] == "insufficient"
    assert protected["charts"] == [] and protected["comparisons"] == []

    for i in range(5):
        insert(db, questionnaire, answers, f"legacy-{i}")
    for i, row in enumerate(list(synthetic_answers(32))[3:], start=3):
        if i == 10:
            del row["commute_time"]
        insert(db, demo, validate_answers(demo, row), f"mixed-demo-{i}")
    data = module_data(db, "academic")
    assert data["eligible_responses"] == 32
    distributions = {chart["key"]: chart for chart in data["mobility"]["charts"]}
    assert distributions.keys() == MOBILITY_TITLES.keys()
    assert distributions["commute_time"]["denominator"] is None
    assert distributions["commute_time"]["missing"] is None
    assert distributions["transport_mode"]["denominator"] == 32
    assert all(chart["status"] == "insufficient" and not chart["data"] for chart in data["mobility"]["comparisons"])
    assert next(chart for chart in overview(db)["charts"] if chart["key"] == "motivation")["denominator"] == 32

    monkeypatch.setattr(get_settings(), "data_mode", "real")
    assert overview(db)["eligible_responses"] == 5
    assert [item["version"] for item in module_data(db, "academic")["versions"]] == [questionnaire.version]
    assert module_data(db, "academic")["mobility"]["charts"] == []
    assert all(item["key"] not in MOBILITY_TITLES for item in module_data(db, "quality")["quality"])

from app import questionnaires
from app.analytics import Context, POOL, module_data, overview
from app.config import get_settings
from app.processing.demo import DEFINITION_PATH, synthetic_answers
from app.questionnaires import load_definition, register_questionnaire, validate_answers
from test_phase2 import insert


def seed_categories(db, questionnaire, answers, cells):
    for index, (overrides, count) in enumerate(cells):
        for i in range(count):
            insert(db, questionnaire, {**answers, **overrides}, f"viz-{index}-{i}")


def test_donut_only_combines_published_categories(db, questionnaire, answers):
    seed_categories(db, questionnaire, answers, [
        ({"dropout_thoughts": "Nunca"}, 20),
        ({"dropout_thoughts": "Rara vez"}, 8),
        ({"dropout_thoughts": "Algunas veces"}, 5),
        ({"dropout_thoughts": "Frecuentemente"}, 4),
    ])
    data = overview(db)
    distribution = data["charts"][0]
    assert distribution["pooled"] and distribution["data"][-1]["label"] == POOL
    composition = data["composition"]
    assert composition["status"] == "ready" and composition["denominator"] == 37
    assert [(row["count"], row["percentage"]) for row in composition["data"]] == [(20, 54.1), (17, 45.9)]
    assert set(composition["grouping_rules"]["dropout_thoughts"]["Ha pensado en abandonar alguna vez"]) == {
        "Rara vez", "Algunas veces", "Frecuentemente", "Muy frecuentemente"}


def test_donut_withholds_never_inside_pool(db, questionnaire, answers):
    seed_categories(db, questionnaire, answers, [
        ({"dropout_thoughts": "Nunca"}, 3),
        ({"dropout_thoughts": "Rara vez"}, 9),
        ({"dropout_thoughts": "Algunas veces"}, 8),
    ])
    chart = overview(db)["composition"]
    assert chart["status"] == "insufficient" and chart["data"] == [] and chart["denominator"] is None


def test_dot_uses_shared_cells_and_weighted_reference(db, questionnaire, answers):
    question = next(q for q in questionnaire.questions if q.key == "university")
    a, b = [o.value for o in question.options[:2]]
    seed_categories(db, questionnaire, answers, [
        ({"university": a, "dropout_thoughts": "Nunca"}, 25),
        ({"university": a, "dropout_thoughts": "Frecuentemente"}, 5),
        ({"university": b, "dropout_thoughts": "Nunca"}, 5),
        ({"university": b, "dropout_thoughts": "Muy frecuentemente"}, 10),
    ])
    chart = module_data(db, "institutional")["institutional_points"]
    assert chart["status"] == "ready"
    assert [(d["label"], d["count"], d["row_denominator"], d["percentage"]) for d in chart["data"]] == [
        (a, 5, 30, 16.7), (b, 10, 15, 66.7)]
    assert chart["reference"] == {"label": "Conjunto seleccionado", "count": 15, "row_denominator": 45, "percentage": 33.3}
    filtered = module_data(db, "institutional", university=a)["institutional_points"]
    assert filtered["data"] == chart["data"][:1] and filtered["reference"] is None


def test_dot_cannot_split_grouped_dropout_categories(db, questionnaire, answers):
    seed_categories(db, questionnaire, answers, [
        ({"dropout_thoughts": "Nunca"}, 10),
        ({"dropout_thoughts": "Rara vez"}, 7),
        ({"dropout_thoughts": "Muy frecuentemente"}, 3),
    ])
    data = module_data(db, "institutional")
    assert data["charts"][1]["status"] == "ready"
    assert data["charts"][1]["grouping_rules"]["dropout_thoughts"]
    chart = data["institutional_points"]
    assert chart["status"] == "insufficient" and chart["data"] == [] and chart["reference"] is None


def test_flow_reserves_all_margins_when_any_filter_atom_is_unsafe(db, monkeypatch):
    monkeypatch.setattr(questionnaires, "require_demo_database", lambda _: None)
    monkeypatch.setattr(get_settings(), "data_mode", "demo")
    q = register_questionnaire(db, load_definition(DEFINITION_PATH))
    row = next(synthetic_answers(1))
    seed_categories(db, q, row, [
        ({"semester": "Segundo o tercero", "transport_mode": "Transporte público", "commute_time": "Hasta 15 minutos"}, 3),
        ({"semester": "Segundo o tercero", "transport_mode": "Automóvil", "commute_time": "31 a 60 minutos"}, 8),
        ({"semester": "Octavo o superior", "transport_mode": "Transporte público", "commute_time": "Hasta 15 minutos"}, 8),
        ({"semester": "Octavo o superior", "transport_mode": "Automóvil", "commute_time": "31 a 60 minutos"}, 8),
    ])
    assert len(Context(db).allowed["semester"]) == 2
    for semester in (None, "Segundo o tercero", "Octavo o superior"):
        flow = module_data(db, "academic", semester=semester)["mobility"]["flow"]
        assert flow["status"] == "insufficient" and flow["denominator"] is None
        assert flow["data"] == flow["rows"] == flow["columns"] == []


def test_flow_keeps_original_labels_and_exact_counts_when_safe(db, monkeypatch):
    monkeypatch.setattr(questionnaires, "require_demo_database", lambda _: None)
    monkeypatch.setattr(get_settings(), "data_mode", "demo")
    q = register_questionnaire(db, load_definition(DEFINITION_PATH))
    seed_categories(db, q, next(synthetic_answers(1)), [
        ({"transport_mode": "Transporte público", "commute_time": "Hasta 15 minutos"}, 5),
        ({"transport_mode": "Transporte público", "commute_time": "31 a 60 minutos"}, 15),
        ({"transport_mode": "A pie", "commute_time": "Hasta 15 minutos"}, 10),
    ])
    flow = module_data(db, "academic")["mobility"]["flow"]
    assert flow["status"] == "ready" and flow["denominator"] == 30
    assert flow["grouping_rules"] == {} and flow["filterable"]
    assert flow["rows"] == ["A pie", "Transporte público"]
    assert flow["columns"] == ["Hasta 15 minutos", "31 a 60 minutos"]
    assert [(d["count"], d["row_denominator"], d["percentage"]) for d in flow["data"]] == [
        (10, 10, 100), (0, 10, 0), (5, 20, 25), (15, 20, 75)]


def test_empty_and_small_have_no_new_public_statistics(db, questionnaire, answers):
    for size in (0, 4):
        if size:
            seed_categories(db, questionnaire, answers, [({}, size)])
        assert "composition" not in overview(db)
        assert "institutional_points" not in module_data(db, "institutional")
        assert "flow" not in module_data(db, "academic")["mobility"]

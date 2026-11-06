import os
from pathlib import Path
import pandas as pd
import pytest
from openpyxl import Workbook
from sqlalchemy import func, select
from app.models import Answer, ImportBatch, SurveyResponse
from app.processing.forms import import_forms
from app.questionnaires import load_definition, register_questionnaire


def make_excel(path, questionnaire, answers, n=37):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["ID", "Nombre", "Correo electrónico"] + [q.source_column for q in questionnaire.questions])
    for i in range(n):
        values = dict(answers)
        if i == 0: values["consent"] = "No acepto"
        if i == 1: values["eligibility"] = "No"
        sheet.append([i + 1, "PERSONAL_DO_NOT_IMPORT", "private@example.invalid"] + [values.get(q.key, "") for q in questionnaire.questions])
    workbook.save(path)


def test_37_received_35_eligible_fixture_and_reimport(tmp_path, db, questionnaire, answers):
    path = tmp_path / "fixture.xlsx"
    make_excel(path, questionnaire, answers)
    report = import_forms(db, path, questionnaire, 37, 35)
    db.commit()
    assert (report["received"], report["eligible"], report["rejected"], report["stored"], report["invalid"]) == (37, 35, 2, 35, 0)
    assert report["validation"]["balance_ok"]
    repeated = import_forms(db, path, questionnaire)
    assert repeated["already_processed"] and repeated["newly_stored"] == 0
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 35
    assert db.scalar(select(func.count()).select_from(ImportBatch)) == 1
    assert not any("PERSONAL_DO_NOT_IMPORT" in value or "@" in value for value in db.scalars(select(Answer.value)))
    # A re-export has different bytes; stable, pseudonymized Forms IDs still deduplicate.
    workbook = __import__('openpyxl').load_workbook(path)
    workbook.active["B2"] = "CHANGED_ADMIN_METADATA"
    workbook.save(path)
    again = import_forms(db, path, questionnaire)
    assert again["duplicates"] == 35 and again["stored"] == 0


def test_expected_counts_fail_before_write(tmp_path, db, questionnaire, answers):
    path = tmp_path / "fixture.xlsx"
    make_excel(path, questionnaire, answers, 38)
    with pytest.raises(ValueError, match="observado 38"):
        import_forms(db, path, questionnaire, expected_received=37)
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 0


def test_immutable_version(db, questionnaire):
    definition = load_definition(Path(__file__).resolve().parents[1] / "configuration/forms-v1.json")
    definition.questions[0].prompt += " changed"
    with pytest.raises(ValueError, match="inmutable"):
        register_questionnaire(db, definition)


def test_real_excel_import_when_available(db, questionnaire):
    path = Path(os.getenv("REAL_FORMS_FILE", "/data/datos.xlsx"))
    if not path.exists():
        path = Path(__file__).resolve().parents[2] / "datos_originales/datos.xlsx"
    if not path.exists(): pytest.skip("Exportación real no disponible en este entorno")
    data = pd.read_excel(path)
    expected_eligible = int(((data.iloc[:, 6] == "Sí, acepto") & (data.iloc[:, 7] == "Sí")).sum())
    report = import_forms(db, path, questionnaire)
    assert report["received"] == len(data)
    assert report["eligible"] == expected_eligible
    assert report["stored"] == expected_eligible
    assert report["invalid"] == 0
    assert import_forms(db, path, questionnaire)["newly_stored"] == 0

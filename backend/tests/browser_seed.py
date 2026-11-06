"""Seed only the disposable form database used by browser integration tests."""
from sqlalchemy import text

from app.config import get_settings
from app.database import SessionLocal
from app.models import Answer, SurveyResponse
from app.processing.demo import fingerprint, synthetic_answers
from app.questionnaires import active_questionnaire, payload_hash, validate_answers


def seed():
    with SessionLocal.begin() as db:
        if (get_settings().data_mode != "real" or db.bind.url.host != "db"
                or db.scalar(text("SELECT current_database()")) != "savra_test"):
            raise RuntimeError("La fixture requiere PostgreSQL desechable savra_test")
        form = active_questionnaire(db)
        questions = {q.key: q for q in form.questions if q.kind == "category"}
        for i, sample in enumerate(synthetic_answers(160)):
            # Translate only the synthetic university labels to allowed form
            # options. Other categorical values share the original instrument.
            sample["university"] = questions["university"].options[i % 2].value
            values = validate_answers(form, {key: sample[key] for key in questions})
            response = SurveyResponse(questionnaire_id=form.id, source="integrated",
                                      fingerprint=fingerprint(i), payload_hash=payload_hash(values))
            db.add(response)
            db.flush()
            db.add_all(Answer(response_id=response.id, question_id=questions[key].id, value=value)
                       for key, value in values.items())


if __name__ == "__main__":
    seed()

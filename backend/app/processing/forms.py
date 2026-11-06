"""Administrative ingestion. Never exposed as a web endpoint."""
import hashlib
import hmac
from pathlib import Path
import pandas as pd
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from ..config import get_settings
from ..models import Answer, ImportBatch, Questionnaire, SurveyResponse
from ..questionnaires import DEMO_VERSION, payload_hash, validate_answers


def fingerprint(namespace: str, source_id: str):
    settings = get_settings()
    secret = settings.fingerprint_secret
    return hmac.new(secret.encode(), f"forms:{namespace}:{source_id}".encode(), hashlib.sha256).hexdigest()


def scalar(value):
    if pd.isna(value):
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def batch_report(batch: ImportBatch, repeated=False):
    return {"file_sha256": batch.file_sha256, "received": batch.received,
            "eligible": batch.eligible, "rejected": batch.rejected, "invalid": batch.invalid,
            "stored": batch.stored, "duplicates": batch.duplicates,
            "newly_stored": 0 if repeated else batch.stored, "already_processed": repeated,
            "validation": batch.validation}


def import_forms(db: Session, path: str | Path, questionnaire: Questionnaire,
                 expected_received: int | None = None, expected_eligible: int | None = None):
    if (get_settings().data_mode == "demo" or questionnaire.provenance.get("data_mode") == "demo"
            or questionnaire.version == DEMO_VERSION):
        raise ValueError("La importación de Forms requiere un entorno y un instrumento de recolección")
    path = Path(path)
    if path.suffix.lower() != ".xlsx":
        raise ValueError("Se requiere una exportación .xlsx")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(724193601)"))
    previous = db.scalar(select(ImportBatch).where(ImportBatch.file_sha256 == digest))
    if previous:
        if previous.questionnaire_id != questionnaire.id:
            raise ValueError("Este archivo ya se procesó con otra versión")
        return batch_report(previous, repeated=True)
    data = pd.read_excel(path, dtype=object, keep_default_na=False)
    columns = [q.source_column for q in questionnaire.questions]
    if "ID" not in data.columns or not set(columns) <= set(data.columns):
        raise ValueError("No coincide el esquema Forms: falta ID o una columna del cuestionario")
    if expected_received is not None and len(data) != expected_received:
        raise ValueError(f"Conteo recibido distinto: esperado {expected_received}, observado {len(data)}")
    batch = ImportBatch(file_sha256=digest, questionnaire_id=questionnaire.id, received=len(data),
                        eligible=0, rejected=0, invalid=0, stored=0, duplicates=0, validation={})
    db.add(batch)
    db.flush()
    by_key = {q.key: q for q in questionnaire.questions}
    issues, exclusion_reasons = [], {"no_consent": 0, "not_enrolled": 0}
    for row_number, (_, row) in enumerate(data.iterrows(), start=2):
        values = {q.key: scalar(row[q.source_column]) for q in questionnaire.questions}
        if values["consent"] not in by_key["consent"].eligible_values:
            batch.rejected += 1
            exclusion_reasons["no_consent"] += 1
            continue
        if values["eligibility"] not in by_key["eligibility"].eligible_values:
            batch.rejected += 1
            exclusion_reasons["not_enrolled"] += 1
            continue
        batch.eligible += 1
        try:
            values = validate_answers(questionnaire, values)
            source_id = scalar(row["ID"])
            if not source_id or not source_id.strip():
                raise ValueError("Falta el ID de origen necesario para deduplicar")
            row_fingerprint = fingerprint(questionnaire.provenance["source_namespace"], source_id)
            content_hash = payload_hash(values)
            existing = db.scalar(select(SurveyResponse).where(SurveyResponse.fingerprint == row_fingerprint))
            if existing:
                if existing.payload_hash != content_hash:
                    raise ValueError("El registro de origen cambió; requiere conciliación administrativa")
                batch.duplicates += 1
                continue
            response = SurveyResponse(questionnaire_id=questionnaire.id, source="microsoft_forms",
                                      fingerprint=row_fingerprint, payload_hash=content_hash, import_batch_id=batch.id)
            db.add(response)
            db.flush()
            db.add_all([Answer(response_id=response.id, question_id=by_key[key].id, value=value)
                        for key, value in values.items()])
            batch.stored += 1
        except ValueError as error:
            batch.invalid += 1
            issues.append({"excel_row": row_number, "reason": str(error)})
    if expected_eligible is not None and batch.eligible != expected_eligible:
        raise ValueError(f"Conteo elegible distinto: esperado {expected_eligible}, observado {batch.eligible}")
    batch.validation = {"exclusion_reasons": exclusion_reasons, "issues": issues,
                        "administrative_columns_discarded": ["ID", "Hora de inicio", "Hora de finalización", "Correo electrónico", "Nombre", "Hora de la última modificación"],
                        "balance_ok": batch.received == batch.rejected + batch.invalid + batch.stored + batch.duplicates}
    db.flush()
    return batch_report(batch)

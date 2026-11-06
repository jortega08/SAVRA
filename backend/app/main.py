import hashlib
import hmac
import secrets
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from .analytics import module_data, overview
from .config import get_settings
from .database import get_db
from .models import Answer, SurveyResponse
from .questionnaires import DEMO_NOTICE, active_questionnaire, payload_hash, public_questionnaire, validate_answers
from .web import RequestLimits, install_frontend

settings = get_settings()
app = FastAPI(title="SAVRA · API pública agregada", version="2.0.0", docs_url=None, redoc_url=None,
              openapi_url=None, redirect_slashes=False)
if settings.frontend_dist:
    app.add_middleware(RequestLimits)
signer = URLSafeTimedSerializer(settings.consent_secret, salt="savra-consent-v1")
COOKIE = "savra_participation"
COMPLETED_COOKIE = "savra_completed"
COMPLETION_LIFETIME = timedelta(days=180)
COOKIE_OPTIONS = {"secure": settings.cookie_secure, "httponly": True, "samesite": "strict", "path": "/api"}
PUBLIC_HOST = urlsplit(settings.public_origin).netloc


@app.middleware("http")
async def request_policy(request: Request, call_next):
    if request.method == "POST" and request.url.path in {"/api/participation/start", "/api/responses"}:
        if settings.data_mode == "demo":
            return JSONResponse({"detail": "La demostración utiliza exclusivamente datos simulados."}, status_code=403)
        if request.headers.getlist("origin") != [settings.public_origin] or request.headers.get("host") != PUBLIC_HOST:
            return JSONResponse({"detail": "Origen no permitido"}, status_code=403, headers={"Cache-Control": "no-store"})
        if request.headers.get("content-type", "").partition(";")[0].strip().lower() != "application/json":
            return JSONResponse({"detail": "Se requiere un cuerpo JSON"}, status_code=415)
        length = request.headers.get("content-length", "0")
        if not length.isdigit():
            return JSONResponse({"detail": "Longitud de contenido inválida"}, status_code=400)
        if int(length) > 32768:
            return JSONResponse({"detail": "Contenido demasiado grande"}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
        "base-uri 'self'; form-action 'self'")
    return response


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, error: SQLAlchemyError):
    return JSONResponse({"detail": "No fue posible acceder al almacenamiento. Inténtalo nuevamente."}, status_code=503)


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/meta")
def meta():
    if settings.data_mode == "demo":
        return {"data_mode": "demo", "data_notice": DEMO_NOTICE}
    return {"data_mode": "real", **({"public_origin": settings.public_origin} if settings.cookie_secure else {})}


@app.get("/api/questionnaire")
def questionnaire(db: Session = Depends(get_db)):
    q = active_questionnaire(db)
    if q is None:
        raise HTTPException(503, "El cuestionario aún no está disponible")
    return public_questionnaire(q)


class StartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accepted: bool
    questionnaire_version: str = Field(max_length=100)


@app.post("/api/participation/start")
def start(body: StartRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    if not body.accepted:
        response.delete_cookie(COOKIE, **COOKIE_OPTIONS)
        return {"accepted": False}
    if confirmed_participation(request, response, db):
        raise HTTPException(409, "Desde este navegador ya se registró una participación. Gracias por contribuir a SAVRA.")
    q = active_questionnaire(db)
    if q is None or body.questionnaire_version != q.version:
        raise HTTPException(409, "El cuestionario cambió. Revisa el consentimiento de nuevo.")
    token = signer.dumps({"version": q.version, "nonce": secrets.token_hex(32)})
    response.set_cookie(COOKIE, token, max_age=7200, **COOKIE_OPTIONS)
    return {"accepted": True}


def consent_session(request: Request, required=True):
    try:
        session = signer.loads(request.cookies.get(COOKIE, ""), max_age=7200)
        if not isinstance(session, dict) or not isinstance(session.get("version"), str) or not valid_nonce(session.get("nonce")):
            raise BadSignature("Invalid session")
        return session
    except (BadSignature, SignatureExpired):
        if required:
            raise HTTPException(403, "Debes aceptar el consentimiento antes de continuar.")
        return None


def valid_nonce(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def session_fingerprint(session):
    return hmac.new(settings.consent_secret.encode(), ("integrated:" + session["nonce"]).encode(), hashlib.sha256).hexdigest()


def completion_expiry(stored):
    # SQLite fixtures return naive UTC; PostgreSQL returns timezone-aware values.
    created = stored.created_at.replace(tzinfo=timezone.utc) if stored.created_at.tzinfo is None else stored.created_at
    return created + COMPLETION_LIFETIME


def stored_participation(db, nonce):
    if not valid_nonce(nonce):
        return None
    return db.scalar(select(SurveyResponse).where(
        SurveyResponse.source == "integrated",
        SurveyResponse.fingerprint == session_fingerprint({"nonce": nonce})))


def mark_completed(response, nonce, stored):
    # The nonce is 256 random bits generated at consent. PostgreSQL retains only
    # its existing HMAC, never the nonce. Reusing it recovers lost HTTP responses
    # without creating another identifier or altering historical records.
    expiry = completion_expiry(stored)
    remaining = int((expiry - datetime.now(timezone.utc)).total_seconds())
    if remaining > 0:
        response.set_cookie(COMPLETED_COOKIE, nonce, max_age=remaining, expires=expiry, **COOKIE_OPTIONS)


def confirmed_participation(request, response, db):
    nonce = request.cookies.get(COMPLETED_COOKIE)
    stored = stored_participation(db, nonce)
    if stored and completion_expiry(stored) > datetime.now(timezone.utc):
        return stored
    # A commit may have succeeded while the response (including Set-Cookie) was
    # lost. The original two-hour consent session can recover the receipt.
    session = consent_session(request, required=False)
    stored = stored_participation(db, session["nonce"]) if session else None
    if stored and completion_expiry(stored) > datetime.now(timezone.utc):
        mark_completed(response, session["nonce"], stored)
        return stored
    return None


@app.get("/api/participation/completed")
def participation_completed(request: Request, response: Response, db: Session = Depends(get_db)):
    return {"completed": confirmed_participation(request, response, db) is not None}


@app.get("/api/participation/status")
def participation_status(request: Request, response: Response, db: Session = Depends(get_db)):
    if confirmed_participation(request, response, db):
        return {"accepted": False, "saved": True}
    session = consent_session(request)
    stored = db.scalar(select(SurveyResponse.id).where(SurveyResponse.fingerprint == session_fingerprint(session)))
    return {"accepted": True, "questionnaire_version": session["version"], "saved": stored is not None}


class Submission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    questionnaire_version: str = Field(max_length=100)
    answers: dict[str, str] = Field(max_length=100)


@app.post("/api/responses")
def submit(body: Submission, request: Request, response: Response, db: Session = Depends(get_db)):
    completed = confirmed_participation(request, response, db)
    session = consent_session(request, required=False)
    if completed and (session is None or completed.fingerprint != session_fingerprint(session)):
        raise HTTPException(409, "Desde este navegador ya se registró una participación. Gracias por contribuir a SAVRA.")
    session = consent_session(request)
    q = active_questionnaire(db)
    if q is None or q.version != body.questionnaire_version or session["version"] != q.version:
        raise HTTPException(409, "La versión del cuestionario cambió. Comienza de nuevo.")
    try:
        answers = validate_answers(q, body.answers, consent_from_session=True)
    except ValueError as error:
        raise HTTPException(422, str(error))
    fingerprint = session_fingerprint(session)
    digest = payload_hash(answers)
    existing = db.scalar(select(SurveyResponse).where(SurveyResponse.fingerprint == fingerprint))
    if existing:
        if existing.payload_hash != digest:
            raise HTTPException(409, "Esta participación ya fue guardada.")
        mark_completed(response, session["nonce"], existing)
        return {"saved": True}
    row = SurveyResponse(questionnaire_id=q.id, source="integrated", fingerprint=fingerprint, payload_hash=digest)
    try:
        db.add(row)
        db.flush()
        by_key = {question.key: question for question in q.questions}
        db.add_all([Answer(response_id=row.id, question_id=by_key[key].id, value=value)
                    for key, value in answers.items()])
        db.commit()
    except IntegrityError:
        db.rollback()
        stored = db.scalar(select(SurveyResponse).where(SurveyResponse.fingerprint == fingerprint))
        if stored is None or stored.payload_hash != digest:
            raise HTTPException(409, "No se pudo guardar esta participación. Verifica su estado.")
        row = stored
    except SQLAlchemyError:
        db.rollback()
        raise
    mark_completed(response, session["nonce"], row)
    return {"saved": True}


def analytics_db(db: Session = Depends(get_db)):
    # A response observes one stable snapshot even when a survey is submitted
    # concurrently. Test sessions already own a rollbackable transaction.
    if isinstance(db.get_bind(), Engine) and db.get_bind().dialect.name == "postgresql" and not db.in_transaction():
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        db.execute(text("SET TRANSACTION READ ONLY"))
    return db


@app.get("/api/overview")
def get_overview(university: str | None = None, semester: str | None = None, db: Session = Depends(analytics_db)):
    if (university and len(university) > 500) or (semester and len(semester) > 500):
        raise HTTPException(422, "Filtro inválido")
    try:
        return overview(db, university, semester)
    except ValueError as error:
        raise HTTPException(422, str(error))


@app.get("/api/analytics/{module}")
def get_analytics(module: str, university: str | None = None, semester: str | None = None, db: Session = Depends(analytics_db)):
    if module not in {"academic", "permanence", "institutional", "quality", "methodology"}:
        raise HTTPException(404, "Módulo no disponible")
    if any(value is not None and len(value) > 500 for value in (university, semester)):
        raise HTTPException(422, "Filtro inválido")
    try:
        return module_data(db, module, university, semester)
    except ValueError as error:
        raise HTTPException(422, str(error))


# Register after the API so unknown /api paths retain a real 404.
if settings.frontend_dist:
    install_frontend(app, settings.frontend_dist)

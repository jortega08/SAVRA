from sqlalchemy import func, select
from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from datetime import datetime, timedelta, timezone
import hashlib
from fastapi.testclient import TestClient
from app.main import app, settings, COOKIE, COMPLETED_COOKIE, completion_expiry, session_fingerprint
from app.models import Answer, SurveyResponse


def begin(client, questionnaire):
    response = client.post("/api/participation/start", json={"accepted": True, "questionnaire_version": questionnaire.version})
    assert response.status_code == 200
    return response


def test_consent_required(client, questionnaire, answers, db):
    assert client.post("/api/responses", json={"questionnaire_version": questionnaire.version, "answers": answers}).status_code == 403
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 0


def test_decline_does_not_persist(client, questionnaire, db):
    accepted = begin(client, questionnaire)
    declined = client.post("/api/participation/start", json={"accepted": False, "questionnaire_version": questionnaire.version})
    assert declined.status_code == 200
    for result in (accepted, declined):
        cookie = result.headers["Set-Cookie"].lower()
        assert all(flag in cookie for flag in ("; secure", "; httponly", "; samesite=strict", "; path=/api"))
        assert "; domain=" not in cookie
    assert "max-age=0" in declined.headers["Set-Cookie"].lower()
    assert client.get("/api/participation/status").status_code == 403
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 0


def test_save_atomic_and_idempotent(client, questionnaire, answers, db):
    begin(client, questionnaire)
    body = {"questionnaire_version": questionnaire.version, "answers": answers}
    for _ in range(2):
        result = client.post("/api/responses", json=body)
        assert result.status_code == 200
        assert result.json() == {"saved": True}
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 1
    assert db.scalar(select(func.count()).select_from(Answer)) == 17
    assert client.get("/api/participation/status").json()["saved"] is True
    another = dict(answers)
    q = next(q for q in questionnaire.questions if q.key == "university")
    another["university"] = q.options[1].value
    assert client.post("/api/responses", json={**body, "answers": another}).status_code == 409


def test_receipt_expiry_normalizes_postgresql_session_time_zone():
    created = datetime(2026, 11, 6, 8, tzinfo=timezone(timedelta(hours=-5)))
    expiry = completion_expiry(SurveyResponse(created_at=created))
    assert expiry.tzinfo is timezone.utc
    assert expiry == datetime(2026, 11, 6, 13, tzinfo=timezone.utc) + timedelta(days=180)


def test_incomplete_ineligible_unknown_rejected(client, questionnaire, answers, db):
    begin(client, questionnaire)
    for invalid in ({**answers, "eligibility": "No"}, {k: v for k, v in answers.items() if k != "university"}, {**answers, "transport_distance": "10"}, {**answers, "gpa_range": "3.8"}):
        assert client.post("/api/responses", json={"questionnaire_version": questionnaire.version, "answers": invalid}).status_code == 422
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 0


def test_cross_origin_and_changed_version(client, questionnaire, answers):
    assert client.post("/api/participation/start", headers={"Origin": "https://another.invalid"}, json={"accepted": True, "questionnaire_version": questionnaire.version}).status_code == 403
    begin(client, questionnaire)
    assert client.post("/api/responses", json={"questionnaire_version": "old", "answers": answers}).status_code == 409


def test_writes_require_exact_origin_and_host_without_forwarded_headers(client, questionnaire):
    path = "/api/participation/start"
    body = {"accepted": True, "questionnaire_version": questionnaire.version}
    for headers in (
        {"Origin": "null"},
        {"Origin": "http://savra.test"},
        {"Host": "other.test", "X-Forwarded-Host": "savra.test", "X-Forwarded-Proto": "https"},
        [("Origin", "https://savra.test"), ("Origin", "https://other.test")],
    ):
        assert client.post(path, headers=headers, json=body).status_code == 403
    missing = client.build_request("POST", path, json=body)
    del missing.headers["Origin"]
    assert client.send(missing).status_code == 403
    assert client.post(path, headers={"Content-Type": "text/plain"}, json=body).status_code == 415
    redirect = client.post(path + "/", json=body, follow_redirects=False)
    assert redirect.status_code == 404 and "location" not in redirect.headers
    preflight = client.options(path, headers={"Origin": "https://other.test", "Access-Control-Request-Method": "POST"})
    assert "Access-Control-Allow-Origin" not in preflight.headers
    assert client.get("/api/participation/status").status_code == 403


def test_no_individual_or_administrative_public_routes(client, questionnaire):
    for path in ("/api/responses", "/api/responses/1", "/api/answers", "/api/imports", "/api/export", "/api/admin", "/docs", "/openapi.json"):
        assert client.get(path).status_code in (404, 405)
    assert client.post("/api/imports", json={}).status_code == 404
    public = client.get("/api/questionnaire").json()
    assert len(public["questions"]) == 18
    assert all("source_column" not in q for q in public["questions"])


def test_storage_failure_cannot_confirm_or_leave_partial_response(client, questionnaire, answers, db):
    begin(client, questionnaire)
    bind = db.get_bind()
    def fail_answer_insert(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().startswith('INSERT INTO answers'):
            raise OperationalError("INSERT", {}, Exception("forced test-only storage failure"))
    event.listen(bind, "before_cursor_execute", fail_answer_insert)
    try:
        result = client.post("/api/responses", json={"questionnaire_version": questionnaire.version, "answers": answers})
        assert result.status_code == 503 and "saved" not in result.json()
    finally:
        event.remove(bind, "before_cursor_execute", fail_answer_insert)
        db.rollback()
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 0
    assert client.get("/api/participation/status").json()["saved"] is False
    assert COMPLETED_COOKIE not in client.cookies
    assert "set-cookie" not in result.headers


def save(client, questionnaire, answers):
    return client.post("/api/responses", json={"questionnaire_version": questionnaire.version, "answers": answers})


def test_persistent_receipt_is_private_random_and_confirmed(client, questionnaire, answers, db):
    started = begin(client, questionnaire)
    assert COMPLETED_COOKIE not in client.cookies
    assert "max-age=7200" in started.headers["set-cookie"].lower()
    result = save(client, questionnaire, answers)
    assert result.status_code == 200
    token = client.cookies.get(COMPLETED_COOKIE)
    assert len(bytes.fromhex(token)) == 32
    cookie = result.headers["set-cookie"].lower()
    assert all(flag in cookie for flag in ("httponly", "secure", "samesite=strict", "path=/api", "expires="))
    assert "domain=" not in cookie
    assert 15551995 <= int(cookie.split("max-age=")[1].split(";")[0]) <= 15552000
    stored = db.scalar(select(SurveyResponse))
    assert stored.fingerprint == session_fingerprint({"nonce": token})
    assert token not in stored.fingerprint and token not in stored.payload_hash
    assert client.get("/api/participation/completed").json() == {"completed": True}
    assert "set-cookie" not in client.get("/api/participation/completed").headers
    # Receipt survives loss/expiry of the two-hour consent, including restart.
    client.cookies.delete(COOKIE)
    assert client.get("/api/participation/status").json() == {"accepted": False, "saved": True}
    assert save(client, questionnaire, answers).status_code == 409
    assert client.post("/api/participation/start", json={"accepted": True, "questionnaire_version": questionnaire.version}).status_code == 409
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 1


def test_lost_response_recovers_receipt_and_does_not_duplicate(client, questionnaire, answers, db):
    begin(client, questionnaire)
    assert save(client, questionnaire, answers).status_code == 200
    token = client.cookies.get(COMPLETED_COOKIE)
    client.cookies.delete(COMPLETED_COOKIE)  # Lost all headers after the commit.
    result = save(client, questionnaire, answers)
    assert result.json() == {"saved": True}
    assert client.cookies.get(COMPLETED_COOKIE) == token
    client.cookies.delete(COMPLETED_COOKIE)
    assert client.get("/api/participation/completed").json() == {"completed": True}
    assert client.cookies.get(COMPLETED_COOKIE) == token
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 1


def test_receipt_absent_unknown_or_tampered_does_not_block(client, questionnaire, answers, db):
    assert client.get("/api/participation/completed").json() == {"completed": False}
    for token in ("manipulated", "a" * 64, "A" * 64, "a" * 1000):
        client.cookies.set(COMPLETED_COOKIE, token, domain="savra.test", path="/api")
        assert client.get("/api/participation/completed").json() == {"completed": False}
    client.cookies.clear()
    begin(client, questionnaire)
    assert save(client, questionnaire, answers).status_code == 200
    client.cookies.delete(COOKIE)
    token = client.cookies.get(COMPLETED_COOKIE)
    client.cookies.set(COMPLETED_COOKIE, ("0" if token[0] != "0" else "1") + token[1:], domain="savra.test", path="/api")
    assert client.get("/api/participation/completed").json() == {"completed": False}


def test_expiry_is_enforced_server_side_and_does_not_slide(client, questionnaire, answers, db):
    begin(client, questionnaire)
    save(client, questionnaire, answers)
    client.cookies.delete(COOKIE)
    stored = db.scalar(select(SurveyResponse))
    stored.created_at = datetime.now(timezone.utc) - timedelta(days=181)
    db.commit()
    assert client.get("/api/participation/completed").json() == {"completed": False}
    begin(client, questionnaire)
    assert save(client, questionnaire, answers).status_code == 200
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 2


def test_commit_failure_never_issues_receipt(client, questionnaire, answers, db, monkeypatch):
    begin(client, questionnaire)
    def fail_commit():
        raise OperationalError("COMMIT", {}, Exception("forced test-only commit failure"))
    with monkeypatch.context() as patch:
        patch.setattr(db, "commit", fail_commit)
        result = save(client, questionnaire, answers)
        assert result.status_code == 503 and "set-cookie" not in result.headers
    assert COMPLETED_COOKIE not in client.cookies
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 0
    assert db.scalar(select(func.count()).select_from(Answer)) == 0
    assert client.get("/api/participation/completed").json() == {"completed": False}
    assert save(client, questionnaire, answers).status_code == 200


def test_other_browser_or_shared_device_profile_can_participate(client, questionnaire, answers, db):
    begin(client, questionnaire)
    save(client, questionnaire, answers)
    with TestClient(app, base_url=settings.public_origin, headers={"Origin": settings.public_origin}) as other:
        assert other.get("/api/participation/completed").json() == {"completed": False}
        begin(other, questionnaire)
        assert save(other, questionnaire, answers).status_code == 200
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 2
    # Declining never erases the completed browser's receipt or stored answers.
    assert client.post("/api/participation/start", json={"accepted": False, "questionnaire_version": questionnaire.version}).json() == {"accepted": False}
    assert client.get("/api/participation/completed").json() == {"completed": True}


def test_receipt_blocks_another_preexisting_consent_session(client, questionnaire, answers, db):
    begin(client, questionnaire)
    old_session = client.cookies.get(COOKIE)
    client.post("/api/participation/start", json={"accepted": False, "questionnaire_version": questionnaire.version})
    begin(client, questionnaire)
    save(client, questionnaire, answers)
    client.cookies.set(COOKIE, old_session, domain="savra.test", path="/api")
    assert save(client, questionnaire, answers).status_code == 409
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 1


def test_reaccepting_unsent_session_retains_identity_without_storing(client, questionnaire, db):
    from app.main import signer
    begin(client, questionnaire)
    original = signer.loads(client.cookies.get(COOKIE))
    begin(client, questionnaire)
    assert signer.loads(client.cookies.get(COOKIE)) == original
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 0


def test_cancel_after_lost_receipt_recovers_completion_and_cannot_duplicate(client, questionnaire, answers, db):
    begin(client, questionnaire)
    save(client, questionnaire, answers)
    client.cookies.delete(COMPLETED_COOKIE)
    result = client.post("/api/participation/start", json={"accepted": False, "questionnaire_version": questionnaire.version})
    assert result.status_code == 200
    assert COOKIE not in client.cookies
    assert COMPLETED_COOKIE in client.cookies
    assert client.post("/api/participation/start", json={"accepted": True, "questionnaire_version": questionnaire.version}).status_code == 409
    assert client.get("/api/participation/status").json()["saved"] is True
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 1


def test_cancel_unsent_session_requires_new_consent_and_changes_identity(client, questionnaire, db):
    from app.main import signer
    begin(client, questionnaire)
    old = signer.loads(client.cookies.get(COOKIE))["nonce"]
    client.post("/api/participation/start", json={"accepted": False, "questionnaire_version": questionnaire.version})
    assert client.get("/api/participation/status").status_code == 403
    begin(client, questionnaire)
    assert signer.loads(client.cookies.get(COOKIE))["nonce"] != old
    assert db.scalar(select(func.count()).select_from(SurveyResponse)) == 0


def test_historical_forms_and_existing_rows_are_untouched(client, questionnaire, answers, db):
    from app.questionnaires import payload_hash
    db.add(SurveyResponse(questionnaire_id=questionnaire.id, source="microsoft_forms",
                          fingerprint=hashlib.sha256(b"historical-import-fixture").hexdigest(), payload_hash=payload_hash(answers)))
    db.commit()
    original = [(r.id, r.source, r.fingerprint, r.payload_hash, r.created_at) for r in db.scalars(select(SurveyResponse))]
    assert client.get("/api/participation/completed").json() == {"completed": False}
    begin(client, questionnaire)
    assert save(client, questionnaire, answers).status_code == 200
    assert [(r.id, r.source, r.fingerprint, r.payload_hash, r.created_at) for r in db.scalars(select(SurveyResponse).where(SurveyResponse.source == "microsoft_forms"))] == original

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.web import Bucket, RequestLimits, install_frontend


def production(**changes):
    return Settings(app_env="production", frontend_dist="/app/static", **{
        "database_url": "postgresql://fixture:fixture@db/savra_test?sslmode=require",
        "public_origin": "https://savra.test", **changes})


def test_neon_url_uses_psycopg_and_preserves_escaped_password_and_tls():
    settings = production(database_url="postgresql://fixture:p%40ss%25word@db/savra_test?sslmode=require&channel_binding=require")
    assert settings.database_url.startswith("postgresql+psycopg://")
    assert "p%40ss%25word" in settings.database_url
    assert "sslmode=require" in settings.database_url
    assert settings.cookie_secure


@pytest.mark.parametrize("changes", [
    {"public_origin": "http://localhost:8080"}, {"data_mode": "demo", "database_url": "postgresql://db/savra_demo?sslmode=require"},
    {"database_url": "postgresql://db/savra_test"}, {"database_url": "sqlite://"},
    {"database_url": "postgresql://db/savra_test?sslmode=prefer"}, {"db_pool_size": 20},
])
def test_production_fails_closed(changes):
    with pytest.raises(ValidationError):
        production(**changes)


@pytest.fixture
def web(tmp_path):
    (tmp_path / "index.html").write_text("<h1>SAVRA fixture</h1>")
    for folder in ("assets", "branding"):
        (tmp_path / folder).mkdir()
    (tmp_path / "assets/app.js").write_text("/* fixture */")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    install_frontend(app, tmp_path)
    return TestClient(app)


@pytest.mark.parametrize("path", ["/", "/encuesta", "/consentimiento", "/gracias", "/observatorio", "/observatorio/metodologia", "/break"])
def test_spa_direct_routes(web, path):
    assert web.get(path).status_code == 200
    assert "SAVRA fixture" in web.get(path).text


@pytest.mark.parametrize("path", ["/.env", "/data/datos.xlsx", "/api/answers", "/docs", "/openapi.json", "/assets/%2e%2e/secret"])
def test_private_routes_are_real_404(web, path):
    assert web.get(path).status_code == 404


def test_missing_assets_do_not_return_html(web):
    assert web.get("/assets/app.js").status_code == 200
    assert web.get("/assets/missing.js").status_code == 404


def test_streaming_body_cannot_bypass_limit():
    app = FastAPI()
    app.add_middleware(RequestLimits)
    with TestClient(app) as client:
        response = client.post("/api/responses", content=iter([b"x" * 20000, b"x" * 20000]))
    assert response.status_code == 413


def test_global_bucket_is_bounded():
    bucket = Bucket(0, 2)
    assert bucket.take() and bucket.take()
    assert not bucket.take()

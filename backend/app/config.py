from functools import lru_cache
import re
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)
    app_env: str = "local"
    database_url: str = "postgresql+psycopg://db:5432/savra_real"
    consent_secret: str
    fingerprint_secret: str
    public_origin: str = "http://localhost:8080"
    data_mode: str = "real"
    questionnaire_file: str = "/app/configuration/forms-v1.json"
    min_group_size: int = 5
    frontend_dist: str | None = None
    db_pool_size: int = 2
    db_max_overflow: int = 1

    @property
    def cookie_secure(self):
        return self.public_origin.startswith("https://")

    @model_validator(mode="after")
    def validate_settings(self):
        origin = urlsplit(self.public_origin)
        host = origin.hostname or ""
        if (
            origin.scheme not in {"http", "https"}
            or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*", host)
            or self.public_origin != f"{origin.scheme}://{host}" + (f":{origin.port}" if origin.port is not None else "")
            or origin.port == 0
            or (origin.scheme == "http" and host not in {"localhost", "127.0.0.1"})
            or origin.port == (443 if origin.scheme == "https" else 80)
        ):
            raise ValueError("PUBLIC_ORIGIN debe ser un origen canónico HTTPS o HTTP de bucle local, sin barra final")
        if len(self.consent_secret) < 32 or self.consent_secret.startswith("GENERATE_"):
            raise ValueError("CONSENT_SECRET debe generarse con scripts/init_env.py o init-env.ps1")
        if len(self.fingerprint_secret) < 32 or self.fingerprint_secret.startswith("GENERATE_"):
            raise ValueError("FINGERPRINT_SECRET debe generarse y conservarse de forma estable")
        if self.data_mode not in {"real", "demo"}:
            raise ValueError("DATA_MODE debe ser real o demo")
        url = make_url(self.database_url)
        # Neon provides libpq URLs; use the installed psycopg v3 driver.
        if url.drivername in {"postgres", "postgresql"}:
            url = url.set(drivername="postgresql+psycopg")
            self.database_url = url.render_as_string(hide_password=False)
        name = url.database or ""
        if self.data_mode == "demo" and (url.get_backend_name() != "postgresql" or not name.endswith("_demo")):
            raise ValueError("Los datos demo requieren una base física terminada en _demo")
        if self.data_mode == "real" and name.endswith("_demo"):
            raise ValueError("Una base demo no puede servirse como real")
        if self.min_group_size < 5:
            raise ValueError("El mínimo público no puede ser menor que cinco")
        if self.app_env not in {"local", "test", "production"}:
            raise ValueError("APP_ENV debe ser local, test o production")
        if not 1 <= self.db_pool_size <= 5 or not 0 <= self.db_max_overflow <= 3:
            raise ValueError("El pool de conexiones debe mantenerse pequeño")
        if self.app_env == "production":
            if "database_url" not in self.model_fields_set or url.get_backend_name() != "postgresql":
                raise ValueError("Producción requiere DATABASE_URL PostgreSQL explícita")
            if url.drivername != "postgresql+psycopg":
                raise ValueError("Producción requiere el controlador psycopg")
            if origin.scheme != "https" or self.data_mode != "real":
                raise ValueError("Producción requiere PUBLIC_ORIGIN HTTPS y DATA_MODE=real")
            if url.query.get("sslmode") not in {"require", "verify-ca", "verify-full"}:
                raise ValueError("Producción requiere TLS explícito en DATABASE_URL")
            if self.consent_secret == self.fingerprint_secret:
                raise ValueError("Los dos secretos deben ser diferentes")
            if not self.frontend_dist:
                raise ValueError("Producción requiere FRONTEND_DIST")
        return self


@lru_cache
def get_settings():
    return Settings()

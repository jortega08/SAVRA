import pytest
from pydantic import ValidationError
from app.config import Settings


def test_demo_requires_physical_database_separation():
    common = {"consent_secret": "test-only-long-enough-secret-" + "a" * 30}
    with pytest.raises(ValidationError, match="base física"):
        Settings(**common, data_mode="demo", database_url="postgresql://db/savra_real")
    with pytest.raises(ValidationError, match="servirse como real"):
        Settings(**common, data_mode="real", database_url="postgresql://db/savra_demo")
    assert Settings(**common, data_mode="demo", database_url="postgresql://db/savra_demo").data_mode == "demo"


def test_minimum_privacy_size_cannot_be_weakened():
    with pytest.raises(ValidationError, match="menor que cinco"):
        Settings(consent_secret="test-only-long-enough-secret-" + "a" * 30, min_group_size=4)


@pytest.mark.parametrize("origin", [
    "http://savra.test", "https://SAVRA.test", "https://savra.test:443", "https://savra.test/",
    "https://savra.test/path", "https://savra.test?query", "https://user@savra.test", "*",
])
def test_rejects_noncanonical_public_origin(origin):
    with pytest.raises(ValidationError, match="PUBLIC_ORIGIN"):
        Settings(public_origin=origin)


def test_https_always_enables_secure_cookies():
    assert Settings(public_origin="https://savra.test", cookie_secure=False).cookie_secure
    assert not Settings(public_origin="http://localhost:8080").cookie_secure

"""Public crawler responses and real branding bytes, without database access or JS."""
from html.parser import HTMLParser
from pathlib import Path
import shutil
import struct

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.web import PUBLIC_ICONS, install_frontend

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
ORIGIN = "https://savra-wacb.onrender.com"
TITLE = "SAVRA | Tu experiencia universitaria cuenta"
DESCRIPTION = "Encuesta voluntaria sobre experiencia académica, movilidad y permanencia universitaria. Participa y comparte tu perspectiva."


class Head(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.meta, self.links = {}, []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "meta":
            self.meta[values.get("property", values.get("name"))] = values.get("content")
        elif tag == "link":
            self.links.append(values)


@pytest.fixture
def public_web(tmp_path):
    if not (FRONTEND / "public").is_dir():
        pytest.skip("Standalone backend image has no frontend; crawler assets are covered by the production suite")
    shutil.copytree(FRONTEND / "public", tmp_path, dirs_exist_ok=True)
    shutil.copyfile(FRONTEND / "index.html", tmp_path / "index.html")
    (tmp_path / "assets").mkdir()
    app = FastAPI()
    install_frontend(app, tmp_path)
    return TestClient(app, base_url=ORIGIN)


@pytest.mark.parametrize("agent", ["facebookexternalhit/1.1", "WhatsApp/2.0", "Twitterbot/1.0"])
@pytest.mark.parametrize("route", ["/", "/index.html", "/gracias"])
def test_crawlers_get_metadata_in_initial_html(public_web, agent, route):
    response = public_web.get(route, headers={"User-Agent": agent})
    assert response.status_code == 200
    head = Head(response.text)
    expected = {"description": DESCRIPTION, "og:title": TITLE, "og:description": DESCRIPTION,
                "og:image": ORIGIN + "/branding/savra-social.png", "og:image:width": "1200",
                "og:image:height": "630", "og:url": ORIGIN, "og:type": "website",
                "og:site_name": "SAVRA", "twitter:card": "summary_large_image",
                "twitter:image": ORIGIN + "/branding/savra-social.png"}
    for key, value in expected.items():
        assert head.meta[key] == value
    assert "Tu experiencia universitaria cuenta" in head.meta["og:image:alt"]
    assert f"<title>{TITLE}</title>" in response.text
    for link in head.links:
        if link.get("rel") in {"icon", "apple-touch-icon"}:
            asset = public_web.get(link["href"])
            assert asset.status_code == 200
            assert asset.headers["content-type"].startswith("image/")


@pytest.mark.parametrize("path,size", [
    ("/favicon-16x16.png", 16), ("/favicon-32x32.png", 32),
    ("/apple-touch-icon.png", 180), ("/icon-192.png", 192), ("/icon-512.png", 512),
    ("/branding/savra-social.png", None),
])
def test_public_png_dimensions_and_content_type(public_web, path, size):
    response = public_web.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", response.content[16:24]) == ((size, size) if size else (1200, 630))
    assert "set-cookie" not in response.headers


def test_ico_contains_three_official_symbol_sizes(public_web):
    response = public_web.get("/favicon.ico")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/x-icon"
    data = response.content
    assert struct.unpack_from("<HHH", data) == (0, 1, 3)
    for index, size in enumerate((16, 32, 48)):
        width, height, _, _, planes, depth, length, offset = struct.unpack_from("<BBBBHHII", data, 6 + index * 16)
        assert (width, height, planes, depth) == (size, size, 1, 32)
        assert data[offset:offset + 8] == b"\x89PNG\r\n\x1a\n"
        assert offset + length <= len(data)


def test_only_explicit_icons_are_public_and_missing_files_stay_404(public_web, tmp_path):
    assert public_web.get("/favicon-unreviewed.png").status_code == 404
    assert public_web.get("/branding/missing.png").status_code == 404
    assert public_web.get("/.env").status_code == 404
    assert public_web.get("/api/not-a-route").status_code == 404
    for name in PUBLIC_ICONS:
        (tmp_path / name).unlink()
        assert public_web.get("/" + name).status_code == 404

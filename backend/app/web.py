"""Static production frontend and bounded API requests in the single worker."""
from pathlib import Path
import re
import time

from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

SPA_PATH = re.compile(r"(?:index\.html|break/?|consentimiento/?|encuesta/?|gracias/?|"
                      r"observatorio(?:/(?:academico|permanencia|institucional|datos|metodologia))?/?)?")
WRITE_PATHS = {"/api/responses", "/api/participation/start"}


class Bucket:
    def __init__(self, rate, capacity):
        self.rate, self.capacity = rate, capacity
        self.tokens, self.updated = float(capacity), time.monotonic()

    def take(self):
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


class RequestLimits:
    """Global limits avoid retaining IP addresses or trusting proxy headers."""
    def __init__(self, app):
        self.app = app
        self.api = Bucket(60, 120)
        self.writes = Bucket(2, 120)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)
        write = scope["method"] == "POST" and scope["path"] in WRITE_PATHS
        if not self.api.take() or (write and not self.writes.take()):
            return await JSONResponse({"detail": "Espera un momento antes de volver a intentarlo."}, 429,
                                      headers={"Retry-After": "1", "Cache-Control": "no-store"})(scope, receive, send)
        if write:
            chunks, size = [], 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                body = message.get("body", b"")
                size += len(body)
                if size > 32768:
                    return await JSONResponse({"detail": "Contenido demasiado grande"}, 413)(scope, receive, send)
                chunks.append(body)
                if not message.get("more_body", False):
                    break
            replayed = False

            async def bounded_receive():
                nonlocal replayed
                if not replayed:
                    replayed = True
                    return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
                return await receive()

            return await self.app(scope, bounded_receive, send)
        return await self.app(scope, receive, send)


def install_frontend(app, directory):
    root = Path(directory).resolve()
    if not (root / "index.html").is_file():
        raise RuntimeError("No existe el frontend compilado")
    for name in ("assets", "branding"):
        app.mount("/" + name, StaticFiles(directory=root / name), name=name)

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if not SPA_PATH.fullmatch(path):
            raise HTTPException(404, "Página no encontrada")
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-store"})

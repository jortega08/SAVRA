"""Generate shareable assets only after verifying a live HTTPS SAVRA origin."""

import argparse
import http.client
import ipaddress
import json
import re
import socket
from pathlib import Path
from urllib.parse import urlsplit

import qrcode
from qrcode.image.pure import PyPNGImage
from qrcode.image.svg import SvgPathFillImage


def verify_url(url: str):
    parts = urlsplit(url)
    host = parts.hostname or ""
    origin = f"https://{host}"
    if url not in {origin, origin + "/"} or not re.fullmatch(
        r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+", host
    ):
        raise ValueError("Use la URL HTTPS exacta de la bienvenida, sin puerto, consulta ni fragmento.")

    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(entry[4][0]).is_global for entry in addresses):
        raise ValueError("El dominio debe resolver únicamente a direcciones públicas.")

    connection = http.client.HTTPSConnection(host, timeout=10)
    try:
        for path, content_type in (("/", "text/html"), ("/api/meta", "application/json")):
            connection.request("GET", path, headers={"ngrok-skip-browser-warning": "1"})
            response = connection.getresponse()
            if response.status != 200 or response.headers.get_content_type() != content_type:
                raise ValueError(f"{path} no devolvió el contenido esperado de SAVRA sin redirecciones.")
            body = response.read(65537)
            if len(body) > 65536:
                raise ValueError(f"{path} devolvió un contenido inesperado.")
            if path == "/" and b"<title>SAVRA " not in body:
                raise ValueError("La página de bienvenida no se identificó como SAVRA.")
            if path == "/api/meta":
                meta = json.loads(body)
                if not isinstance(meta, dict) or meta.get("data_mode") != "real" or meta.get("public_origin") != origin:
                    raise ValueError("El endpoint no sirve el entorno real configurado con este PUBLIC_ORIGIN.")
    finally:
        connection.close()


def write_qr(url: str, output: Path):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, box_size=48, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    output.mkdir(parents=True, exist_ok=True)
    with (output / "savra-qr.png").open("wb") as image:
        qr.make_image(image_factory=PyPNGImage).save(image)
    with (output / "savra-qr.svg").open("wb") as image:
        qr.make_image(image_factory=SvgPathFillImage).save(image)
    (output / "savra-url.txt").write_text(url + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="URL pública exacta de la página de bienvenida")
    parser.add_argument("--output", type=Path, default=Path(".local/qr"))
    args = parser.parse_args()
    try:
        verify_url(args.url)
        write_qr(args.url, args.output)
    except (ValueError, OSError, http.client.HTTPException) as error:
        parser.exit(1, f"Error: {error}\n")
    print(f"URL verificada. PNG, SVG y dirección guardados en {args.output}.")


if __name__ == "__main__":
    main()

"""Create local Docker configuration without printing or embedding real secrets."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
target = root / ".env"
if target.exists():
    raise SystemExit(".env ya existe; se conserva sin cambios.")
content = (root / ".env.example").read_text()
content = content.replace("POSTGRES_PASSWORD=GENERATE_WITH_INIT_SCRIPT", "POSTGRES_PASSWORD=" + secrets.token_hex(24))
content = content.replace("CONSENT_SECRET=GENERATE_WITH_INIT_SCRIPT", "CONSENT_SECRET=" + secrets.token_hex(32))
content = content.replace("FINGERPRINT_SECRET=GENERATE_WITH_INIT_SCRIPT", "FINGERPRINT_SECRET=" + secrets.token_hex(32))
target.write_text(content, encoding="utf-8")
print(".env creado. Conserve FINGERPRINT_SECRET para mantener la deduplicación de las importaciones.")

# SAVRA

Sistema de Análisis y Visualización del Riesgo Académico. Conserva la aplicación existente: encuesta con consentimiento, observatorio agregado y SAVRA Break (Reflex y 2048).

## Desarrollo local

Con Docker Desktop iniciado, desde PowerShell:

```powershell
./scripts/init-env.ps1
docker compose up --build -d --wait
```

Abra http://localhost:8080. El proyecto Compose `savra` mantiene frontend, FastAPI y PostgreSQL local. El script de inicialización conserva un `.env` existente. No ejecute `docker compose down -v`: el volumen contiene la base local. El arranque registra el instrumento, pero nunca importa Excel ni genera respuestas.

## GitHub y Render + Neon

- [Despliegue, conexión a GitHub y variables de Render](docs/despliegue-render.md).
- [Migración posterior a Neon y verificación de integridad](docs/migracion-neon.md).
- [Archivos públicos, secretos y auditoría del repositorio](docs/seguridad.md).
- [Resultados de preparación y pruebas](docs/preparacion-validacion.md).

El Dockerfile de la raíz compila React/TypeScript y sirve los assets y `/api` desde FastAPI en un único puerto. Usa PostgreSQL externo, TLS y un proceso de Uvicorn. Render termina HTTPS; `PUBLIC_ORIGIN` determina el dominio permitido y las cookies seguras. La imagen no contiene importador, generador demo, Excel ni datos sintéticos. El Docker Compose local se conserva.

`.env.example` y `.env.production.example` son plantillas documentales, sin secretos utilizables. Nunca copie el `.env` local al repositorio. Para trasladar el histórico, conserve los secretos locales por un canal privado y siga la guía de migración antes de abrir el servicio al público.

## Pruebas

```powershell
Push-Location frontend
npm ci
npm test
npm run build
npx playwright install chromium
Pop-Location

docker build -t savra-backend:latest ./backend
python scripts/test_isolated.py backend

docker build -t savra-render:preparacion .
python scripts/test_production.py
```

Las pruebas de escritura usan PostgreSQL desechable en contenedores y redes temporales que se eliminan al terminar. No crean proyectos Compose adicionales ni usan el volumen real. La prueba de producción usa los assets servidos por la propia imagen, un proxy TLS efímero, PostgreSQL externo con TLS, un límite de 512 MiB y un sistema de archivos de solo lectura.

Comprobaciones de solo lectura sobre la base local:

```powershell
python scripts/database_manifest.py --local-compose --expect-responses 37 --expect-answers 653 --output .local/release-audit/manifest.json
python scripts/audit_repository.py
```

Ajuste los conteos esperados si se han recibido nuevas participaciones legítimas. El manifiesto privado compara todas las tablas, huellas, relaciones y secuencias. Los textos abiertos y las respuestas individuales no se exponen mediante la API pública; los agregados conservan el mínimo de cinco registros y las reglas de supresión existentes.

Las definiciones del cuestionario son código de configuración, no respuestas. El catálogo inicial refleja las opciones observadas en la exportación original; el responsable debe revisar opciones nunca observadas antes de crear otra versión. Las pruebas generan fixtures exclusivamente dentro de bases desechables.

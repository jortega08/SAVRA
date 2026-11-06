# Preparación y validación · 6 de noviembre de 2026

SAVRA queda preparado para el primer push y para un servicio Docker en Render con PostgreSQL externo. No se ha ejecutado push, creado un servicio Render ni conectado o migrado la base a Neon. El remoto configurado es la URL entregada por el titular; no se ha comprobado la visibilidad mediante una sesión remota.

## Resultados

| Comprobación | Resultado |
| --- | --- |
| React/TypeScript, build local y build multietapa Docker | Correctos |
| Vitest / Testing Library | 48 pruebas aprobadas |
| Pytest local con SQLite aislado | 95 pruebas aprobadas |
| Pytest en PostgreSQL 17 desechable | 94 aprobadas, 1 omitida por ausencia del Excel privado |
| Alembic sobre PostgreSQL aislado | Upgrade y `alembic check` correctos, sin diferencias de esquema |
| Chromium contra los assets de la imagen de producción | 3 pruebas completas aprobadas |
| Encuesta de cinco pasos, cookies HTTPS, confirmación y prevención de repetición | Correctos en PostgreSQL desechable |
| Seis módulos del observatorio, React, assets y SAVRA Break | Correctos en la imagen de producción |
| Rutas privadas y archivos inexistentes | 404 reales, sin devolver HTML de éxito |
| Origen incorrecto y cuerpo excesivo | 403 y 413, respectivamente |
| Conexión externa PostgreSQL | TLS y channel binding exigidos durante la prueba |
| Fallo provocado en bootstrap | Transacción de migración revertida completamente |
| Reinicio de producción | Manifiesto de prueba idéntico antes y después |
| Ensayo de pg_dump/pg_restore | Solo fixture desechable; tablas, huellas y secuencias idénticas |
| Contenedor de producción | Usuario sin privilegios, filesystem de solo lectura, sin volúmenes persistentes |
| Memoria observada | 64,41 MiB tras navegador; 62 MiB tras reinicio; límite 512 MiB, sin OOM |
| Base real local | 37 participaciones y 653 respuestas; manifiestos completos idénticos antes y después |
| Aplicación local en 8080 | Rutas y observatorio verificados en Chromium con todas las escrituras bloqueadas |

Los conteos de memoria son muestras de esta prueba pequeña, no un pico de carga garantizado. Los 512 MB del plan Free se documentan en [Render Compute Plans](https://render.com/docs/compute-plans). La imagen no incluye Pandas, NumPy, openpyxl, pytest, generador demo, importador Excel ni datasets. No se alteró `compose.yaml` ni se recrearon los servicios reales.

Las pruebas crean únicamente contenedores y redes efímeros, sin proyectos Compose ni volúmenes persistentes adicionales. El PostgreSQL real se consulta con transacciones de solo lectura; no recibe POST de prueba. El ensayo de transferencia utiliza una participación inventada en un PostgreSQL desechable, nunca el histórico real.

Advertencias de herramientas: Vite informa un chunk ECharts mayor de 500 kB; el build concluye correctamente. Pytest informa una deprecación del adaptador httpx de Starlette; las pruebas concluyen correctamente. No se cambiaron las dependencias de la aplicación para resolver advertencias ajenas al despliegue.

## Archivos de esta preparación

- Raíz y CI: `.gitignore`, `.dockerignore`, `.gitattributes`, `.env.production.example`, `Dockerfile`, `README.md`, `.github/workflows/ci.yml`.
- Backend: `.dockerignore`, `app/config.py`, `app/database.py`, `app/main.py`, `app/startup.py`, `app/web.py`, `migrations/env.py`, `requirements.production.lock.txt`, `tests/test_production.py`.
- Frontend: `.dockerignore`, `playwright.production.config.ts`, `production-e2e/production.spec.ts`, `scripts/verify-readonly.mjs` (selectores ajustados al detalle ampliado existente).
- Herramientas: `scripts/audit_repository.py`, `scripts/database_manifest.py`, `scripts/restore_neon.py`, `scripts/test_production.py`.
- Documentación: `docs/despliegue-render.md`, `docs/migracion-neon.md`, `docs/seguridad.md` y este informe.

El primer commit completo también incluye el código y las pruebas preexistentes, los dos PNG de marca y las plantillas sin secretos. Conserva los cambios de frontend que estaban presentes al comenzar. La rama anterior permanece local; las capturas y documentos históricos siguen en disco y están excluidos de la publicación.

La auditoría se ejecuta sobre todos los candidatos antes de agregarlos, sobre el índice antes del commit y sobre el historial del commit preparado. Compara también los secretos del `.env` local sin imprimirlos. La evidencia detallada de integridad y ejecución queda bajo `.local/release-audit/`, ignorada por Git y Docker.

## Pendientes externos

Se requiere autorización expresa para `git push -u origin HEAD:main`. Después se podrá restaurar el histórico en Neon durante una ventana sin escrituras y comparar manifiestos. El titular deberá conectar GitHub y configurar las variables en Render siguiendo la guía; las pruebas contra Neon y el dominio real se harán entonces, sin envíos de prueba a la base migrada.

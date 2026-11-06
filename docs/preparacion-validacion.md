# Preparación y validación · 6 de noviembre de 2026

Este informe conserva los resultados de la preparación inicial. El commit ecdb041 se publicó posteriormente con autorización. La [actualización de encuesta v2](encuesta-v2.md) contiene el estado vigente del formulario y su validación; sus cambios quedan locales hasta nueva autorización.

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

## Favicon y sistema para compartir · 6 de noviembre de 2026

Se agregaron iconos derivados exclusivamente de `frontend/public/branding/isotipo_savra.png`, conservando su proporción y transparencia: ICO con 16/32/48 px, PNG de 16/32/192/512 px y Apple Touch Icon de 180 px. Los dos originales de marca permanecen intactos. La tarjeta `frontend/public/branding/savra-social.png` mide 1200 × 630 px e integra el logotipo, el isotipo, Manrope y la paleta #2B2D33 / #E4E6EA / #F2412C. No contiene estadísticas.

Los metadatos están en `frontend/index.html` y se entregan con `FileResponse` antes de ejecutar React. `og:image` apunta a `https://savra-wacb.onrender.com/branding/savra-social.png`. FastAPI permite únicamente los nombres explícitos de iconos en la raíz; las rutas API y las restricciones de archivos privados se mantienen. Las listas de Docker y de la auditoría incorporan solo los nuevos recursos revisados.

La bienvenida y el agradecimiento confirmado incluyen un control discreto «Compartir SAVRA». Intenta Web Share API y ofrece WhatsApp, copia de enlace e invitación y selección manual si el portapapeles está bloqueado. Las cancelaciones nativas son normales. El mensaje usa la URL pública fija, sin respuestas, cookies, recibos, parámetros ni fragmentos de navegación. El formulario y el consentimiento no incluyen controles de compartir.

| Validación de este cambio | Resultado |
| --- | --- |
| Vitest / Testing Library | 60 aprobadas, incluidas 9 pruebas específicas de compartir |
| Pytest local, SQLite en memoria | 195 aprobadas |
| TypeScript y Vite | Build correcto |
| Dockerfile raíz de producción | Imagen compilada correctamente con todos los recursos |
| Navegador sobre imagen de producción y HTTPS | 11 aprobadas: flujo existente, rutas, seguridad, metadatos sin JS, iconos, copia real y compartir |
| Regresión analítica sobre la misma imagen | 1 aprobada |
| Perfiles de compartir | Escritorio/Chromium, Android/Chromium e iPhone/WebKit; sin desbordamiento horizontal |
| Accesibilidad | Teclado, confirmación con `role=status`, foco y selección de la alternativa manual |
| Privacidad del contenido compartido | Solo mensaje fijo y URL pública, incluso desde una URL con recibo y fragmento ficticios |
| Ciclo de producción aislado | Arranque, rollback, TLS, reinicio y dump/restore con manifiestos idénticos |
| Memoria tras reiniciar | 64,05 MiB de un límite de 512 MiB, sin OOM |
| Auditoría del repositorio | Correcta sobre candidatos, índice e historial; sin secretos ni rutas privadas |

Las pruebas móviles usan perfiles emulados; los diálogos nativos se simulan para probar éxito, cancelación y fallos. No se enviaron mensajes ni se verificó un teléfono físico. La copia a un portapapeles real se probó en Chromium sobre HTTPS, admitiendo la normalización CRLF de Windows. Las capturas revisadas están en `.local/sharing-audit/`, fuera de Git. La prueba de backend que lee los PNG del repositorio se omite dentro de la imagen de backend independiente, donde no existe el frontend; la suite de producción comprueba los bytes reales de la imagen completa.

En la consulta de solo lectura, la página de Render y `/api/health` respondieron HTTP 200; la versión publicada aún carece de los nuevos metadatos. No se hizo push ni despliegue. La disponibilidad de los nuevos recursos en la URL pública y la tarjeta real de WhatsApp/Facebook quedan pendientes de publicar con autorización y de que las plataformas renueven su caché. No se modificaron la base real, los registros históricos, los secretos, las variables de Render ni el cuestionario activo.

Permanecen las advertencias previas sobre el tamaño del chunk ECharts y la deprecación httpx de Starlette. Los comandos reproducibles están en el README; en esta máquina la suite de producción se ejecutó con `.\.venv\Scripts\python.exe scripts/test_production.py` para evitar la redirección del almacenamiento de navegadores de Python de Microsoft Store.

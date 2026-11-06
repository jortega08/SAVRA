# Preparación segura del repositorio

El repositorio preparado contiene código, definiciones del cuestionario sin respuestas, los dos PNG oficiales de marca, sus iconos derivados y la tarjeta social revisada, archivos de dependencias, configuración de ejemplo, documentación pública y pruebas con fixtures creadas por código. Los commits se escriben en español.

`.gitignore` excluye entornos y secretos, `.local`, Excel, CSV, bases y respaldos, certificados y claves, dependencias, temporales, capturas e informes históricos locales y el directorio personal de identidad visual. Solo se permiten expresamente cinco documentos públicos en `docs`. Los informes previos y capturas se conservan en disco; la rama de publicación no los contiene.

El Dockerfile raíz usa un contexto con lista de permitidos en `.dockerignore`, además de copias explícitas. No envía `.env`, originales, respaldos, informes ni dependencias instaladas al constructor. La imagen final tampoco contiene el generador demo, su definición, el importador Excel, fixtures o pruebas. Los Dockerfiles de desarrollo continúan separados para Compose.

La rama limpia `codex/preparacion-render` conserva el trabajo existente sin incorporar el historial anterior. `main` permanece local como referencia. Para GitHub se subirá solo `HEAD:main`, después de autorización. No publique todas las ramas ni etiquetas: la protección del archivo actual no elimina contenido de commits anteriores.

`python scripts/audit_repository.py` inspecciona los bytes del índice y los blobs del historial alcanzable desde HEAD, no solo sus nombres. Rechaza rutas privadas, tipos sin revisar, binarios ajenos a la lista explícita de recursos de marca y patrones comunes de tokens o claves privadas. Esa lista permite únicamente los dos originales, `branding/savra-social.png`, `favicon.ico`, los favicon PNG de 16 y 32 px, `apple-touch-icon.png` y los iconos de 192 y 512 px bajo `frontend/public`; no habilita PNG o ICO arbitrarios. También compara el contenido contra los secretos presentes en el `.env` local y sus versiones codificadas para URL, sin imprimir sus valores. La revisión incluye lectura del código y documentación; un escáner por patrones no prueba la ausencia de cualquier secreto imaginable.

El sistema mantiene cookies seguras en HTTPS, validación exacta de Origin/Host, respuestas agregadas con supresión de grupos pequeños, ausencia de endpoints públicos de importación y microdatos, límites globales de API y cuerpos de escritura de 32 KiB. El servicio de producción no confía en cabeceras reenviadas para autorizar solicitudes ni conserva IPs para el límite. Los límites son por instancia y se reinician con el proceso; no constituyen una garantía de una persona por respuesta.

El backup real y sus verificaciones quedan en carpetas privadas; nunca se agregan con `git add -f`. El procedimiento de preparación no envía datos a Neon, no crea servicios Render, no modifica la visibilidad de GitHub y no hace push sin autorización expresa.

## Auditoría privada del observatorio

Desde la raíz del repositorio, con las dependencias del backend instaladas:

```powershell
pwsh -NoProfile -File scripts/audit_observatory.ps1 -Baseline 37
```

`-Baseline` calcula la variación neta desde un total de referencia. `-Since` acepta un instante ISO 8601 con zona horaria para contar las participaciones guardadas desde ese corte. `-VerifyFilters` agrega consultas GET para las selecciones ofrecidas por Render. `-Python` permite elegir un intérprete con las dependencias cuando la ruta predeterminada de `.venv` no está disponible.

El lanzador comprueba el destino directo registrado en `.local/neon` y puede usar `SAVRA_AUDIT_DSN` del proceso para una credencial con permisos SELECT. Si esa variable está ausente, usa la credencial protegida con DPAPI del equipo. La conexión exige TLS, autenticación con channel binding y una transacción de solo lectura con instantánea estable. Las consultas públicas son GET a las rutas autorizadas de Render. Los archivos de diagnóstico contienen conteos de uso administrativo y se escriben exclusivamente en `.local/observatory-audit`.

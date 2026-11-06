# Preparación segura del repositorio

El repositorio preparado contiene código, definiciones del cuestionario sin respuestas, dos PNG de marca revisados, archivos de dependencias, configuración de ejemplo, documentación pública y pruebas con fixtures creadas por código. Los commits se escriben en español.

`.gitignore` excluye entornos y secretos, `.local`, Excel, CSV, bases y respaldos, certificados y claves, dependencias, temporales, capturas e informes históricos locales y el directorio personal de identidad visual. Solo se permiten expresamente cuatro documentos públicos en `docs`. Los informes previos y capturas se conservan en disco; la rama de publicación no los contiene.

El Dockerfile raíz usa un contexto con lista de permitidos en `.dockerignore`, además de copias explícitas. No envía `.env`, originales, respaldos, informes ni dependencias instaladas al constructor. La imagen final tampoco contiene el generador demo, su definición, el importador Excel, fixtures o pruebas. Los Dockerfiles de desarrollo continúan separados para Compose.

La rama limpia `codex/preparacion-render` conserva el trabajo existente sin incorporar el historial anterior. `main` permanece local como referencia. Para GitHub se subirá solo `HEAD:main`, después de autorización. No publique todas las ramas ni etiquetas: la protección del archivo actual no elimina contenido de commits anteriores.

`python scripts/audit_repository.py` inspecciona los bytes del índice y los blobs del historial alcanzable desde HEAD, no solo sus nombres. Rechaza rutas privadas, tipos sin revisar, binarios ajenos a los dos PNG de marca y patrones comunes de tokens o claves privadas. También compara el contenido contra los secretos presentes en el `.env` local y sus versiones codificadas para URL, sin imprimir sus valores. La revisión incluye lectura del código y documentación; un escáner por patrones no prueba la ausencia de cualquier secreto imaginable.

El sistema mantiene cookies seguras en HTTPS, validación exacta de Origin/Host, respuestas agregadas con supresión de grupos pequeños, ausencia de endpoints públicos de importación y microdatos, límites globales de API y cuerpos de escritura de 32 KiB. El servicio de producción no confía en cabeceras reenviadas para autorizar solicitudes ni conserva IPs para el límite. Los límites son por instancia y se reinician con el proceso; no constituyen una garantía de una persona por respuesta.

El backup real y sus verificaciones quedan en carpetas privadas; nunca se agregan con `git add -f`. El procedimiento de preparación no envía datos a Neon, no crea servicios Render, no modifica la visibilidad de GitHub y no hace push sin autorización expresa.

# GitHub privado y Render Free

## Repositorio preparado

URL proporcionada por el titular: `https://github.com/jortega08/SAVRA.git`. El primer commit ecdb041 ya se publicó con autorización expresa. La actualización de encuesta v2 permanece local hasta una nueva autorización; no se cambia la visibilidad privada.

La rama `codex/preparacion-render` conserva el primer commit completo y la actualización de encuesta v2. El historial local anterior permanece en `main`, separado de esta rama. Suba únicamente la rama preparada: no use `--all`, `--mirror`, `--tags` ni un push de la antigua `main`.

Antes del push se requiere la autorización expresa del titular. Después de recibirla:

```powershell
git switch codex/preparacion-render
git remote get-url origin
python scripts/audit_repository.py
git push -u origin HEAD:main
```

`origin` debe apuntar exactamente a la URL indicada. Si hace falta autenticación, use el diálogo oficial de Git Credential Manager/GitHub al ejecutar Git, o `gh auth login --web` si GitHub CLI está instalado. Nunca escriba un token en la URL del remoto, en el código ni en la documentación. Si el repositorio dejó de estar vacío, deténgase a conciliar su contenido; no fuerce el push.

## Orden de despliegue

1. Termine la migración de la base real y compare sus manifiestos, siguiendo [migracion-neon.md](migracion-neon.md). No arranque Render contra el destino antes de restaurarlo: el arranque crearía el esquema y dejaría de estar vacío.
2. En Render, conecte GitHub mediante su integración oficial y autorice acceso solo al repositorio privado SAVRA. Seleccione **New → Web Service**, el repositorio y la rama remota `main`.
3. Seleccione runtime **Docker**, contexto raíz `.`, Dockerfile `./Dockerfile`, plan **Free**. Deje el directorio raíz y Docker Command sin sobrescribir. Elija una región cercana a Neon AWS us-east-1 entre las disponibles en su cuenta.
4. Configure las variables indicadas abajo antes del primer deploy. El origen debe ser la URL HTTPS asignada por Render, en minúsculas y sin barra final; no suponga un subdominio antes de verlo en Render.
5. Configure Health Check Path `/api/health`. No cree otro PostgreSQL, disco, worker ni servicio de frontend. Para el primer despliegue, mantenga la publicación controlada hasta terminar las verificaciones de solo lectura.
6. Abra inicio, consentimiento, `/observatorio` y `/break`; revise los seis módulos y ambos juegos. Compruebe `/api/health` y `/api/meta`. No envíe encuestas de prueba a la base migrada.

Render expone el servicio por HTTPS y reenvía tráfico a `0.0.0.0:$PORT`; proporciona `PORT` automáticamente. Véase [Web Services](https://render.com/docs/web-services). Las migraciones se ejecutan durante el arranque porque el comando pre-deploy no está disponible en Free, según [Deploying on Render](https://render.com/docs/deploys#pre-deploy-command).

## Variables de Render

| Variable | Valor o criterio |
| --- | --- |
| `DATABASE_URL` | Conexión **directa** al destino migrado en Neon. `postgresql://` y `postgresql+psycopg://` son aceptadas. Conservar parámetros TLS de Neon, al menos `sslmode=require`; se recomienda conservar `channel_binding=require` y `connect_timeout=15`. Nunca guardar la URL real en Git. |
| `PUBLIC_ORIGIN` | Origen HTTPS exacto asignado al servicio, sin ruta ni barra final. Debe coincidir con el dominio utilizado por el navegador. |
| `CONSENT_SECRET` | Copiar privadamente el valor local existente al migrar el histórico. Estable, aleatorio y de al menos 32 caracteres. Firma sesiones y participa en huellas de encuestas integradas. |
| `FINGERPRINT_SECRET` | Copiar privadamente el valor local existente. Distinto del anterior y de al menos 32 caracteres. Preserva deduplicación de Forms. |
| `APP_ENV` | `production` (también fijado en la imagen). |
| `DATA_MODE` | `real` (también fijado en la imagen). |
| `MIN_GROUP_SIZE` | `5`; nunca menor. |
| `DB_POOL_SIZE` | `2`. |
| `DB_MAX_OVERFLOW` | `1`. |
| `PORT` | Lo proporciona Render; la imagen usa `10000` cuando no se proporciona. No fijar `8000`. |
| `FRONTEND_DIST` | `/app/static`, incluido en la imagen; no requiere configuración manual. |
| `QUESTIONNAIRE_FILE` | `/app/configuration/savra-integrada-v2.json`, incluido en la imagen; no requiere configuración manual. Un destino que ya tiene cuestionario activo conserva esa selección hasta una activación administrativa explícita. |

No configure `POSTGRES_PASSWORD`, `POSTGRES_USER` ni `POSTGRES_DB` en Render: pertenecen a Compose local. No copie automáticamente `.env`. Traslade solo las variables requeridas desde una interfaz privada; no las pegue en el chat. Al cambiar dominio, actualice `PUBLIC_ORIGIN` y vuelva a desplegar.

Las cookies de sesión y confirmación son propias del dominio, `HttpOnly`, `SameSite=Strict`, `Path=/api` y siempre `Secure` con HTTPS. No hay una variable que permita desactivar `Secure` en producción. El nuevo dominio no recibe cookies del dominio local. Conservar los secretos mantiene las huellas almacenadas, pero no traslada cookies entre dominios.

La conexión directa se usa porque el mismo proceso ejecuta Alembic y necesita bloqueo transaccional al arrancar. El pool local permite como máximo tres conexiones por proceso. [Neon recomienda conexión directa para migraciones y pg_dump/pg_restore](https://neon.com/docs/connect/connection-pooling#connection-types-and-recommendations).

## Arranque y memoria

La imagen usa un usuario sin privilegios, un solo worker, hasta 32 solicitudes concurrentes, pool pequeño y dependencias de ejecución separadas. No incluye Pandas, NumPy, openpyxl, pytest, importador, generador demo, archivos de respuestas ni PostgreSQL. Los assets compilados son de solo lectura. Sesiones e identificadores se validan con PostgreSQL y cookies; no dependen de archivos persistentes.

Antes de escuchar, el arranque adquiere un bloqueo asesor transaccional, ejecuta `alembic upgrade head` y registra el instrumento únicamente si falta en una base sin respuestas. Cualquier fallo revierte esa transacción y cancela el arranque. No reactiva versiones históricas, importa datos ni genera encuestas. Las futuras migraciones deben conservar compatibilidad con el despliegue anterior durante la transición; un rollback de Render no revierte la base.

Render Free suspende servicios tras 15 minutos sin tráfico y usa almacenamiento efímero. El siguiente acceso puede tardar aproximadamente un minuto en despertar el servicio. Las cuotas y límites deben revisarse en el panel antes del uso. Véanse [limitaciones de Free](https://render.com/docs/free). El límite de 512 MiB se reproduce en la prueba local; esto no sustituye una prueba de carga con el volumen futuro.

# Migración controlada de PostgreSQL 17 a Neon PostgreSQL 18

Procedimiento adaptado y ensayado el 6 de noviembre de 2026 para **origen 17.11 → destino Neon 18.6**. La restauración de datos reales está pendiente de autorización expresa. El formulario local permanece cerrado; PostgreSQL y su volumen no se detienen ni se sustituyen.

## Compatibilidad comprobada

La documentación de [pg_dump de PostgreSQL](https://www.postgresql.org/docs/18/app-pgdump.html) admite restaurar respaldos lógicos en versiones posteriores y recomienda citar todos los identificadores al cambiar de versión. Se usa **pg_dump 17.11**, del origen, y **pg_restore 18.6**, del destino. No se usa pg_upgrade ni copia del directorio de datos entre versiones. [Neon requiere una conexión directa](https://neon.com/docs/import/migrate-from-postgres).

Ensayo reproducible:

    python scripts/test_pg17_to_pg18.py
    python scripts/test_neon_migration_guards.py -q

El primer script crea PostgreSQL 17.11 y 18.6 en una red Docker interna temporal, sin puertos publicados y con datos en tmpfs. PostgreSQL 18 monta /var/lib/postgresql, respetando el [cambio de PGDATA de la imagen oficial](https://hub.docker.com/_/postgres). No crea proyectos Compose ni volúmenes permanentes. Las fixtures no proceden de la base real ni se envían a Neon.

Resultados:

- Dos participaciones de prueba, 45 respuestas, ambos cuestionarios y v2 activa conservados exactamente al restaurar en 18.6.
- Igualdad de tablas, SHA-256 canónicos, relaciones, huellas de contenido, secuencias, Alembic y versión activa. Se incluyen Unicode, texto condicional, fechas y JSON.
- Restauración con un rol propietario de la base **sin superusuario**, sin trasladar roles ni permisos del servidor local.
- Alembic current, upgrade head y check correctos antes y después: sin operaciones pendientes ni cambios en los datos restaurados.
- Suite completa sobre PostgreSQL 18.6: **177 aprobadas y una omitida** porque falta el Excel privado en el entorno aislado.
- Cinco pruebas de guardas aprobadas: checksum incorrecto, cambio de destino, destino no vacío y conexión pooled detienen la operación; restauración válida transaccional sin flags destructivos.

El esquema real usa tablas, secuencias, claves foráneas, índices, JSON y timestamps con zona horaria. Se comprobó UTF-8 y ausencia de extensiones de usuario, rutinas de usuario, objetos grandes, tablas particionadas e índices inválidos. No fue necesario cambiar modelos, migraciones ni dependencias de la aplicación para PostgreSQL 18.

## Destino y conexión segura

Destino confirmado por el titular en Neon Console/SQL Editor: proyecto **savra-real**, **AWS us-east-1**, rama **Producción / Primaria**, base **neondb**. La identidad y el endpoint esperado se guardan solo en target-identity.json, dentro del directorio privado de la ejecución. No se deduce el proyecto por el nombre de la base.

El directorio vigente se registra en .local/neon/active-run.json. Ingresar la conexión enmascarada y comprobar el destino:

    pwsh -NoProfile -File scripts/neon_secure.ps1 -Action SaveCredential
    pwsh -NoProfile -File scripts/neon_secure.ps1 -Action Preflight

neon.dpapi está cifrado para el usuario actual de Windows. La conexión se descifra solo en memoria de un proceso local y se elimina de su entorno al terminar. No se copia .env ni se imprimen URLs o contraseñas.

Si se copió una cadena pooled, el helper puede convertir únicamente su hostname al endpoint directo equivalente **ya confirmado**. Cualquier otro hostname se rechaza. Nunca se conecta al pooler para migrar.

El preflight es de solo lectura y exige versión exacta esperada, base y endpoint correctos, TLS y destino vacío. Deben ser cero tablas, secuencias, vistas, rutinas y tipos de aplicación en esquemas no internos, además de objetos grandes. El resultado se guarda en target-preflight.json.

TLS se exige con sslmode=require o verify-full y channel_binding=require. Se comprueba en el cliente mediante [libpq PQsslInUse](https://www.postgresql.org/docs/18/libpq-status.html). El estado de pg_stat_ssl del backend se conserva solo como diagnóstico y no sustituye la comprobación del transporte del cliente a Neon.

## Corte de escrituras y respaldo

1. Detener solo el frontend: docker compose stop frontend. Cerrar túneles públicos si existen. Dejar backend y db activos; no ejecutar importadores ni operaciones administrativas de escritura.
2. Leer nuevamente versión, conteos y cuestionarios con REPEATABLE READ y READ ONLY. El corte comprobado es **37 participaciones, 653 respuestas, forms-v1 y savra-integrada-v2, con v2 activa**. Si cambia, detener y conciliar; nunca borrar filas para igualarlo.
3. Crear source-before.json con database_manifest.py y los conteos realmente observados; comprobar relaciones, huellas, secuencias y ausencia de cuestionarios demo.
4. Crear el archivo dentro de db, con permisos restrictivos y nombre temporal único:

    pg_dump --format=custom --quote-all-identifiers --no-owner --no-acl
            --no-tablespaces --lock-wait-timeout=20s --file=ARCHIVO_PRIVADO

Usuario y base se toman de variables del contenedor, sin imprimirlas. Copiar con docker compose cp a .local/neon/RUN/savra-neon.dump; no redirigir el binario mediante PowerShell. Eliminar solo el archivo temporal del contenedor después de comprobar la copia.

5. Guardar archive.sha256. Verificar cabecera, catálogo con pg_restore --list y lectura/descompresión completa con pg_restore 18.6 --file=/dev/null, **sin conectar a un servidor ni restaurar datos**. Deben estar las siete tablas con datos y las seis secuencias.
6. Crear source-after.json y exigir coincidencia exacta con source-before.json para detectar cualquier escritura concurrente.
7. Restringir el directorio al usuario actual y SYSTEM. Crear una segunda copia DPAPI bajo %LOCALAPPDATA%/SAVRA/MigrationBackups, fuera del repositorio. Verificar descifrado en memoria y el mismo SHA-256. DPAPI depende del usuario/equipo Windows; conservar el perfil y sus claves según la política del responsable.

El respaldo preparado ocupa **38.345 bytes**. Hash, lectura completa y copia cifrada constan privadamente en backup-verification.json, archive.sha256 y encrypted-backup.json. Procede exclusivamente de PostgreSQL real; no incluye datos demo ni reimporta Excel.

## Punto de confirmación obligatorio

**DETENERSE AQUÍ:** presentar destino, versiones, conteos, versión activa, ensayo y SHA-256 del respaldo. Solicitar autorización expresa para restaurar esa copia concreta. Guardar una credencial o confirmar un preflight no autoriza la restauración.

Solo después de recibir autorización:

    pwsh -NoProfile -File scripts/neon_secure.ps1 -Action Restore -ConfirmRestore

El helper exige frontend detenido, ensayo 17→18 satisfactorio y origen idéntico al respaldo. restore_neon.py vuelve a validar SHA-256, versión, endpoint, rol, base y vacío justo antes de operar. Emplea el cliente 18.6 con transacción única:

    pg_restore --single-transaction --exit-on-error --no-owner --no-acl
               --no-comments --no-security-labels --no-tablespaces

No utiliza --clean, --create ni desactivación de triggers; no sobrescribe objetos. Un error cancela la transacción y exige revisión antes de reintentar. La salida potencialmente sensible no se imprime. Render y el formulario permanecen sin publicar; no crear objetos manuales en Neon durante la ventana.

## Verificación posterior a la restauración autorizada

    pwsh -NoProfile -File scripts/neon_secure.ps1 -Action Verify

Exigir igualdad completa con source-after.json: siete tablas, conteos, SHA-256 canónicos, fuentes de respuestas y estados de secuencias. Incluye las definiciones y la bandera activa de los dos cuestionarios. Recalcula hashes de contenido y comprueba relaciones, unicidad, preguntas obligatorias y secuencias que no reutilicen IDs.

Comprobar también forms-v1 y savra-integrada-v2, solo v2 activa y manifiesto local intacto. No ejecutar bootstrap, importaciones ni respuestas de prueba contra Neon.

Solo después de esa igualdad se podrá confirmar una copia íntegra y continuar con Render. Los secretos de sesión y deduplicación originales se conservan por canal privado. Un rollback de Render no revierte PostgreSQL.

Ante diferencias, no abrir el formulario, no volver a restaurar sobre un destino con objetos y no modificar el origen. Si se cancela antes de que Neon reciba respuestas, docker compose start frontend recupera el servicio local sin alterar el volumen. Si Neon ya recibió respuestas legítimas, conciliar ambos históricos antes de volver al origen.

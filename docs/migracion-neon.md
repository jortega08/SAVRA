# Migración posterior de la base real a Neon

Procedimiento preparado, **no ejecutado**. No se ha conectado a Neon ni transferido datos reales. El origen sigue siendo el volumen PostgreSQL del único Compose `savra`.

## Preparación y corte de escrituras

1. Confirme en Neon el proyecto `savra-real` de AWS us-east-1, la rama, rol, base y versión PostgreSQL elegidos. Utilice un destino vacío con PostgreSQL 17 para este procedimiento. El nombre de proyecto no implica que la base también se llame `savra-real`. No use una base o rama con datos demo.
2. No cree ni despliegue Render contra ese destino todavía. Conserve el `.env` local y sus dos secretos en un gestor privado; se necesitarán en Render. No genere sustitutos al trasladar el histórico.
3. Acuerde una ventana sin recolección. Detenga solo el frontend local con `docker compose stop frontend`, cierre cualquier túnel público y deje backend y db activos para las comprobaciones. No ejecute importadores ni comandos de escritura durante la ventana. Espere a que terminen los envíos en curso. El volumen real no se elimina ni se restaura sobre sí mismo.
4. Compruebe los conteos del momento. El corte verificado durante la preparación fue 37 participaciones y 653 respuestas a preguntas. Si llegaron registros legítimos nuevos, documente el nuevo corte y actualice ambos parámetros. Nunca borre registros para igualar un conteo.

## Exportación privada consistente

Desde la raíz en PowerShell, con Docker Desktop iniciado y Python disponible:

```powershell
python scripts/database_manifest.py --local-compose --expect-responses 37 --expect-answers 653 --output .local/neon/source-before.json
if ($LASTEXITCODE -ne 0) { throw 'Detenga la migración: integridad de origen no validada' }

docker compose exec -T db sh -ec 'umask 077; pg_dump --format=custom --no-owner --no-acl --file=/tmp/savra-neon.dump -U "$POSTGRES_USER" "$POSTGRES_DB"'
if ($LASTEXITCODE -ne 0) { throw 'Falló el respaldo' }
docker compose cp db:/tmp/savra-neon.dump .local/neon/savra-neon.dump
if ($LASTEXITCODE -ne 0) { throw 'Falló la copia del respaldo' }
docker compose exec -T db rm -f /tmp/savra-neon.dump

python scripts/database_manifest.py --local-compose --expect-responses 37 --expect-answers 653 --compare .local/neon/source-before.json --output .local/neon/source-after.json
if ($LASTEXITCODE -ne 0) { throw 'El origen cambió durante la exportación; no restaure este corte' }
(Get-FileHash -LiteralPath .local/neon/savra-neon.dump -Algorithm SHA256).Hash | Set-Content .local/neon/archive.sha256
```

El archivo binario se genera dentro del contenedor y se copia con `docker compose cp`, evitando redirecciones binarias de PowerShell. `pg_dump` lee una instantánea consistente y no modifica los registros del origen. Incluye todas las tablas, Alembic, IDs, huellas HMAC, fechas, relaciones y secuencias; no exporta roles del servidor ni requiere superusuario en Neon. No se vuelve a importar el Excel ni se generan registros demo.

Los respaldos contienen datos privados. `.local` está ignorado por Git y Docker, pero eso no cifra ni restringe permisos de Windows. Guarde una segunda copia cifrada fuera del repositorio, accesible solo al responsable. No suba el archivo ni sus manifiestos a GitHub ni a Render. Para comprobar una copia, vuelva a calcular SHA-256 y compárela con `archive.sha256`.

## Restauración explícita y transaccional

Copie desde Neon su conexión **directa**, sin `-pooler` en el hostname, con TLS y rol autorizado. La guía oficial utiliza [pg_dump y pg_restore](https://neon.com/docs/import/migrate-from-postgres); [la documentación de pooling](https://neon.com/docs/connect/connection-pooling) exige conexión directa para esas herramientas.

El script siguiente solo acepta un hostname `*.neon.tech`, un respaldo bajo `.local`, TLS y un destino sin tablas, vistas ni secuencias de aplicación en `public`. Requiere una opción explícita y no usa `--clean`, no borra objetos ni toca PostgreSQL local. Docker ejecuta un cliente efímero sin volumen ni proyecto Compose adicional. Errores y credenciales no se imprimen.

```powershell
$env:NEON_DATABASE_URL = Read-Host 'Conexión DIRECTA de Neon con TLS' -MaskInput
try {
    $expectedHash = (Get-Content .local/neon/archive.sha256).Trim()
    if ((Get-FileHash .local/neon/savra-neon.dump -Algorithm SHA256).Hash -ne $expectedHash) {
        throw 'El respaldo no coincide con su huella'
    }
    python scripts/restore_neon.py .local/neon/savra-neon.dump --confirm-empty-neon
    if ($LASTEXITCODE -ne 0) { throw 'Restauración detenida; no continúe con Render' }

    # El verificador necesita SQLAlchemy y psycopg instalados en este Python.
    # Instalar previamente: python -m pip install -r backend/requirements.production.lock.txt
    python scripts/database_manifest.py --database-env NEON_DATABASE_URL --expect-responses 37 --expect-answers 653 --compare .local/neon/source-after.json --output .local/neon/target.json
    if ($LASTEXITCODE -ne 0) { throw 'El destino no coincide; no publique Render' }
} finally {
    Remove-Item Env:NEON_DATABASE_URL -ErrorAction SilentlyContinue
}
```

Use PowerShell 7 para `Read-Host -MaskInput`. No escriba la URL literal en una orden, ni la pase como argumento de Python. El cliente recibe usuario, contraseña y parámetros mediante variables de proceso; no se registran en Git. El script restaura con `--single-transaction --exit-on-error --no-owner --no-acl` y captura su salida para evitar exponer valores de filas ante errores.

## Criterios de aceptación

Los dos manifiestos deben coincidir completamente, incluidas las seis tablas de aplicación, `alembic_version`, conteos, SHA-256 de cada tabla ordenada y estados de secuencias. Se comprueban además:

- Ninguna pregunta, opción, importación, participación ni respuesta huérfana; cuestionario coherente en todas las relaciones.
- Unicidad y formato de huellas de participación; unicidad de respuesta por pregunta.
- Recalcular `payload_hash` desde las respuestas completas y compararlo con el almacenado.
- Preguntas obligatorias presentes y secuencias que no reutilizarán IDs.
- Solo fuentes reales permitidas, sin cuestionarios demo. El origen debe ser exclusivamente la base real: no se puede inferir por contenido si alguien introdujo manualmente una fixture con apariencia de respuesta real.

Los manifiestos no muestran respuestas ni HMAC individuales en terminal. Se guardan privadamente y las validaciones usan `REPEATABLE READ` y `READ ONLY` del servidor. Las huellas HMAC se trasladan sin recalcularlas desde IDs originales, que no están almacenados. Preservar los secretos permite mantener la deduplicación posterior.

## Apertura o recuperación

Solo después de una coincidencia exacta, configure Render con el destino validado y los secretos conservados; despliegue y haga verificaciones de solo lectura. Mantenga cerrada la recolección local para evitar dos bases que reciban respuestas independientes. Conserve íntegros el volumen local y el respaldo.

Ante cualquier diferencia, no abra Render ni sobrescriba el origen. Conserve evidencia privada y revise el corte. Si decide cancelar antes de abrir Neon a participantes, recupere el servicio local con `docker compose start frontend`; esto conserva todos sus registros. Si Neon ya recibió respuestas, primero concilie ambos históricos: no vuelva sin más al respaldo anterior.

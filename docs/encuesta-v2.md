# Encuesta SAVRA · savra-integrada-v2

Actualización del 6 de noviembre de 2026. La versión está registrada y activa en el Compose local existente, en `http://localhost:8080`. El código queda en `codex/preparacion-render`, con un commit adicional al publicado anteriormente. Esta actualización no se sube a GitHub ni se migra a Neon sin autorización.

## Instrumento y revisión de catálogos

La definición está en `backend/configuration/savra-integrada-v2.json`: 24 preguntas principales, incluido el consentimiento, y tres seguimientos de texto que solo aparecen al elegir «Otro». El formulario conserva cinco pasos: elegibilidad, perfil, experiencia académica, economía y movilidad, permanencia/dificultades/preferencias.

La fuente `forms-v1` recuperó exclusivamente opciones observadas, no todas las opciones posibles de Microsoft Forms. Se conserva su archivo byte por byte y su definición registrada. En v2 se completan expresamente los catálogos solicitados; los catálogos heredados restantes continúan pendientes de revisión por el responsable y no se declaran exhaustivos (`option_set_complete=false`).

- Asignaturas reprobadas: Ninguna, Una, Dos, Tres o más y No aplica por no haber finalizado un semestre.
- Promedio: 0,0–2,9; 3,0–3,4; 3,5–3,9; 4,0–4,4; 4,5–5,0; No aplica por no tener promedio. Son categorías de la escala declarada a una cifra decimal; no se convierten a puntos medios, notas exactas ni promedios calculados.
- Semestre: se añade **Primero**, necesario para que quienes aún no terminaron un semestre no tengan que declararse en segundo o tercero. Las demás categorías se conservan literalmente.
- Dificultad principal: selección única, con Dificultades de transporte y un detalle condicional al elegir Otro.
- Se añaden cambio de municipio para estudiar, transporte principal, tiempo, costo semanal, retrasos y apoyo institucional principal. Se conservan todas las opciones solicitadas, incluido Prefiero no responder en cambio de municipio y No lo sé en costo.

Las doce áreas tienen ejemplos breves y opciones inclusivas:

| Área | Ejemplos |
| --- | --- |
| Educación | Pedagogía, licenciaturas, educación infantil |
| Artes y humanidades | Artes, música, historia, filosofía |
| Ciencias sociales y comunicación | Sociología, psicología, comunicación social |
| Administración, negocios y derecho | Administración, contaduría, negocios, derecho |
| Ciencias naturales, matemáticas y estadística | **Biología**, química, física, matemáticas, estadística |
| Tecnologías de la información y comunicación | Informática, software, redes |
| Ingeniería, industria y construcción | Ingeniería civil, industrial, mecánica, arquitectura |
| Agricultura, ciencias agropecuarias y veterinaria | Agronomía, zootecnia, **Medicina Veterinaria** |
| Salud y bienestar | Medicina, enfermería, odontología, fisioterapia |
| Servicios, turismo y áreas afines | Turismo, hotelería, gastronomía, servicios |
| Otra área / No encuentro mi carrera | Carreras no encontradas en las anteriores |
| No estoy seguro(a) | No sabe cuál área elegir |

El área no determina elegibilidad: Otra área y No estoy seguro(a) permiten participar. Los únicos criterios de elegibilidad siguen siendo consentimiento y matrícula actual en una carrera universitaria en Colombia.

## Textos y privacidad

`main_difficulty_other`, `transport_mode_other` y `preferred_support_other` admiten hasta 300 caracteres. El navegador y el servidor los exigen únicamente cuando se elige su opción Otro. Si cambia la selección, React descarta ese texto; el servidor rechaza texto residual que no corresponda. El comentario final sigue siendo opcional, con límite de 2.000 caracteres.

Los textos se almacenan como respuestas restringidas al acceso administrativo a la base. No se incluyen en consultas analíticas, rutas públicas de respuestas, tablas de agregados, exportaciones, capturas reales compartidas ni registros. El servidor no devuelve su contenido al informar errores. No se solicitan nombres, documentos, municipio concreto de origen ni direcciones.

## Compatibilidad y cobertura

| Variables | Tratamiento |
| --- | --- |
| Trece preguntas históricas conservadas | Declaración explícita y comprobación de redacción, tipo y opciones idénticas; reorganizar pasos no altera significado. |
| Promedio | Las tres categorías históricas conservan exactamente sus intervalos. Se elimina solo el prefijo «De» en la consulta de agregados, mediante un mapa declarado; el valor almacenado permanece igual. |
| Reprobadas, semestre y dificultad principal | Mapas de identidad exhaustivos para las opciones históricas. Las opciones nuevas no se asignan a registros anteriores. |
| Área de conocimiento | Sin equivalencia automática: las categorías antiguas agrupan campos que ahora se separan. La distribución nueva muestra únicamente valores compatibles de v2 y declara su cobertura. |
| Seis preguntas nuevas | Solo respuestas de savra-integrada-v2. No se usa el instrumento demo ni se imputan datos al histórico. |

Los filtros universitarios y de semestre siguen incluyendo ambas versiones y sus grupos publicables. Los totales generales cuentan todas las participaciones reales; cada gráfico declara su denominador y la falta de cobertura compatible. Gestión de datos identifica las variables nuevas y su versión de introducción.

Exploración académica incluye seis distribuciones nuevas, medio frente a tiempo en Sankey, retrasos frente a pensamientos de abandono y cambio de municipio frente a dificultad principal en mapas de calor. Los cruces usan solo registros v2 con cobertura conjunta. Los rangos ordinales conservan su orden; los cruces no implican causalidad ni predicción.

La protección conserva `k=5`, supresión complementaria y la partición compartida de filtros. Además, antes de divulgar una matriz de v2 se comprueban los grupos y complementos históricos en todas las particiones y los márgenes compartidos con estadísticas generales. Si una resta puede revelar un grupo menor de cinco, se reserva el cruce completo. El Sankey exige celdas seguras en todas las subdivisiones publicables. No se crean flujos ficticios para rellenar gráficos vacíos.

## Reinicio, consentimiento y envío

| Caso | Comportamiento |
| --- | --- |
| Primera participación | Consentimiento previo; solo un envío completo y válido crea filas. |
| Volver al inicio antes de enviar | Se descartan las respuestas en memoria. Al volver se muestra consentimiento; se conserva la identidad de la sesión vigente para proteger envíos que lleguen tarde. |
| Cancelar encuesta | Elimina la cookie de consentimiento y los valores del formulario. Volver a empezar requiere aceptar otra vez y crea una sesión nueva si no hubo guardado. |
| Recargar | No se guarda borrador en navegador ni PostgreSQL. Se vuelve al primer paso con campos vacíos y se comprueba el estado en el servidor. |
| Envío confirmado | Cookie de confirmación y página de agradecimiento verificadas con PostgreSQL. Reintentar el mismo envío es idempotente. |
| Volver al inicio después de enviar | La bienvenida reconoce la participación completada. Entrar al formulario vuelve a la confirmación. |
| Cancelar tras perder la respuesta HTTP de un guardado | Recupera primero la confirmación usando la sesión original; cancelar no borra el reconocimiento del envío ya almacenado. |

Se conservan cookies HttpOnly/SameSite/Secure con HTTPS, control exacto de Origin/Host, caducidad y validación transaccional. La marca reduce repeticiones desde el mismo navegador; borrar cookies o usar otro perfil conserva las limitaciones ya documentadas.

## Duración y móvil

La estimación orientativa es **6–8 minutos**, considerando 24 preguntas principales, consentimiento y posibles detalles. Hay 648 palabras en preguntas y catálogos, más ejemplos y consentimiento; las selecciones requieren tiempo de lectura y decisión. El flujo automatizado completo tarda alrededor de 10–12 segundos y **no mide el tiempo humano**. No se presenta como resultado de un piloto con estudiantes.

Las áreas se presentan como una lista de selección única con etiquetas que ajustan línea y ejemplos; el desplazamiento es el de la página, sin una lista interior que atrape el scroll. La validación móvil usa 390 px, comprueba todas las áreas y opciones nuevas, campos condicionales y ausencia de desbordamiento horizontal.

## Activación y conservación local

Se actualizaron únicamente backend y frontend del Compose `savra`; PostgreSQL y su volumen permanecieron activos. Antes se creó un respaldo privado y manifiestos bajo `.local/areas-v2-audit/`. La activación añadió metadatos de v2 y cambió el indicador administrativo `active` de la versión anterior; no cambió su definición, preguntas, opciones ni respuestas.

El comando administrativo, disponible también en la imagen de producción sin Pandas ni importador, es:

```powershell
docker compose exec -T backend python -m app.instrument prepare savra-integrada-v2
docker compose exec -T backend python -m app.instrument activate savra-integrada-v2
```

`prepare` registra sin sustituir el instrumento activo. `activate` es explícito, transaccional y comparte el bloqueo de arranque. Un destino vacío inicia v2; restaurar una base con versión activa conserva esa selección. No se reescribe el historial para hacerlo coincidir con v2.

## Validación

- Frontend: 51 pruebas aprobadas y compilación React/TypeScript correcta.
- Backend: 178 pruebas locales aprobadas; 177 aprobadas en PostgreSQL 17 aislado y una omitida por ausencia del Excel privado. Cubren catálogos completos, campos condicionales, idempotencia, compatibilidad y privacidad.
- Producción: cuatro pruebas Chromium/HTTPS, PostgreSQL externo con TLS, contenedor limitado a 512 MiB, reinicio y dump/restore de la fixture idénticos.
- Histórico real: **37 participaciones y 653 respuestas** conservadas; SHA-256 de filas históricas idénticos, con la única excepción prevista del indicador administrativo de versión activa. También se validan relaciones, huellas de contenido y secuencias.
- Las únicas respuestas ficticias se enviaron o generaron en bases desechables. Las comprobaciones de la aplicación real bloquean escrituras.
- Capturas de prueba y respaldo quedan bajo `.local`, excluidos de Git y de la imagen Docker. Las capturas de movilidad llevan una etiqueta visible de datos aislados.

Advertencias existentes: chunk ECharts superior a 500 kB y deprecación del adaptador de pruebas Starlette/httpx; no impiden la compilación ni las pruebas.

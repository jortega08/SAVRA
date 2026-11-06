import { ArrowRight, ChartNoAxesColumnIncreasing, ClipboardList, Database, Search, ShieldCheck } from 'lucide-react'
import { formatPercent } from '@/components/chartOptions'
import type { AnalyticsData } from '@/lib/api'

export function Quality({ data }: { data: AnalyticsData }) {
  const demo = data.data_mode === 'demo'
  return <>
    <section className="quality-table"><h2>Cobertura por pregunta</h2><p>Proporción de respuestas válidas para cada pregunta.</p>{data.quality.length ? <div className="table-scroll" role="region" aria-label="Cobertura de variables" tabIndex={0}><table aria-label="Cobertura por pregunta"><thead><tr><th scope="col">Pregunta / dimensión</th><th scope="col">Tipo</th><th scope="col">Válidos</th><th scope="col">Sin valor compatible</th><th scope="col">Cobertura</th><th scope="col">Disponibilidad</th></tr></thead><tbody>{data.quality.map(q => <tr key={q.key}><th scope="row">{q.title}{q.introduced_in && <small className="variable-version">Desde {q.introduced_in}</small>}</th><td>{q.kind === 'ordinal' ? 'Ordinal' : 'Categórica'}</td><td>{q.valid ?? '—'}</td><td>{q.missing ?? '—'}</td>
      <td>{q.coverage_percentage != null ? <div className="coverage-value">{formatPercent(q.coverage_percentage)}<div className="proportion-band" aria-hidden="true"><span style={{ width: `${q.coverage_percentage}%` }} /></div></div> : '—'}</td>
      <td><span className={`availability ${q.status}`}>{q.status === 'ready' ? 'Publicable' : q.status === 'unavailable' ? 'No disponible' : 'Protegida'}</span>{q.message && <details><summary>Motivo</summary><p>{q.message}</p></details>}</td></tr>)}</tbody></table></div> : <p>Aún no hay cobertura publicable para esta selección. El instrumento y los criterios de validación se conservan disponibles.</p>}</section>
    <details className="analysis-notes">
      <summary>Fuentes, versiones y validación</summary>
      <div className="quality-context">
        <section><h2>Procedencia</h2><p>{data.sources?.join('. ')}</p><p>{data.received_message}</p></section>
        <section><h2>Instrumentos</h2><ul className="version-list">{data.versions.map(v => <li key={v.version}><strong>{v.version}</strong><span>{v.active ? 'Activo' : 'Histórico'} · {v.options_basis === 'integrated_reviewed_v2' ? 'Catálogo ampliado; variables heredadas por revisar' : demo && v.options_complete ? 'Catálogo de simulación' : v.options_complete ? 'Catálogo verificado' : 'Opciones observadas en la fuente'}</span></li>)}</ul><p>La compatibilidad de cada variable requiere una declaración explícita y una definición equivalente.</p></section>
        <section><h2>Validación antes del análisis</h2><ol className="validation-list"><li>{demo ? 'Elegibilidad simulada según el instrumento.' : 'Consentimiento y matrícula actual.'}</li><li>Preguntas obligatorias y opciones reconocidas.</li><li>{demo ? 'Semilla fija y control de duplicados.' : 'Control de duplicados e importación idempotente.'}</li><li>Persistencia transaccional y agregación protegida.</li></ol><p>{demo ? 'La generación se realiza mediante la CLI de la demostración.' : 'La importación y la conciliación se realizan mediante la CLI administrativa.'}</p></section>
        <section><h2>Alcance de la cobertura</h2><p>La cobertura se reserva cuando permite deducir un grupo pequeño.</p><p>{demo ? 'La cobertura de movilidad corresponde al instrumento sintético. Los rangos de costo y tiempo se conservan como categorías.' : 'Movilidad, cambio de municipio y preferencias de apoyo se recopilan desde savra-integrada-v2. No se imputan al histórico; su cobertura se muestra por separado. No se mide deserción efectiva y los textos abiertos quedan restringidos.'}</p></section>
      </div>
    </details>
  </>
}

const process = [
  { name: 'Recolección', summary: 'Instrumento versionado', icon: ClipboardList },
  { name: 'Validación', summary: 'Elegibilidad y compatibilidad', icon: ShieldCheck },
  { name: 'Almacenamiento', summary: 'PostgreSQL y procedencia', icon: Database },
  { name: 'Análisis', summary: 'Agregados y supresión', icon: Search },
  { name: 'Visualización', summary: 'Gráficos y tablas públicas', icon: ChartNoAxesColumnIncreasing },
]

export function MethodologyContent({ demo = false, filterNote, minimumGroupSize }: {
  demo?: boolean; filterNote?: string; minimumGroupSize: number
}) {
  const sections = [
    ['Propósito y fuente', demo ? 'La demostración ejercita los módulos de SAVRA con registros completamente sintéticos en una base PostgreSQL dedicada. Una operación administrativa genera las categorías con una semilla fija.' : 'El observatorio presenta datos reales de una encuesta sobre continuidad universitaria. Las respuestas proceden de Microsoft Forms y del formulario integrado de SAVRA. No se dispone de series históricas institucionales.'],
    demo ? ['Diseño de la simulación', 'El generador usa distribuciones ponderadas. Por ejemplo, las probabilidades de los rangos de tiempo y costo varían según el medio de transporte. Las relaciones son supuestos técnicos de la simulación. Los filtros delimitan la base sintética de cada análisis.'] : ['Participación, elegibilidad y muestra', 'La participación es voluntaria. Solo se incluyen respuestas con consentimiento y matrícula actual en una carrera universitaria en Colombia. El muestreo es no probabilístico por conveniencia. El tamaño de muestra mostrado arriba se consulta desde PostgreSQL y cambia con las participaciones elegibles; los filtros delimitan la base seleccionada. No representa a toda la población universitaria.'],
    [demo ? 'Variables simuladas' : 'Variables observadas', demo ? 'Se conservan las categorías del instrumento histórico donde coinciden. La versión de demostración añade otra categoría universitaria y cinco variables de movilidad. Tiempo y costo se analizan como rangos categóricos.' : 'Se observan categorías de semestre, promedio, asignaturas reprobadas, ausencias, horas remuneradas, dificultad económica, manejo de la carga, apoyo institucional, motivación y perspectivas de continuidad. La nueva versión incorpora movilidad, cambio de municipio y preferencias de apoyo. Los rangos académicos se conservan como categorías. No se sustituyen por valores exactos ni se promedian escalas ordinales.'],
    ['Cálculos y denominadores', 'Cada distribución usa las respuestas válidas y compatibles de la pregunta. Las matrices muestran frecuencias conjuntas, porcentajes por fila y su denominador. Un cruce con cobertura parcial puede mostrarse si ambas preguntas comparten los mismos registros compatibles y la falta de cobertura es divulgable. Las reglas descriptivas indican qué categorías suman. Los ceros publicados corresponden a recuentos observados y el redondeo puede producir diferencias respecto del 100 %.'],
    ['Privacidad y consultas relacionadas', `El mínimo para publicar un grupo es de ${minimumGroupSize} registros. Las primeras participaciones se muestran como intervalo. También se protegen los complementos y las intersecciones de los filtros. Una reserva de privacidad puede incluir categorías adicionales si la resta revela un recuento pequeño. El catálogo conserva las etiquetas originales. Los cruces priorizan las categorías del instrumento y solo usan agrupaciones explícitas cuando protegen celdas. Los márgenes que permitirían reconstruir grupos pequeños quedan reservados.`],
    ...(filterNote ? [['Filtros del observatorio', filterNote]] : []),
    ['Límites e interpretación', demo ? 'Los cruces ilustran el funcionamiento de las visualizaciones y describen únicamente el conjunto simulado. Los pensamientos de abandono son categorías del instrumento y el generador los selecciona independientemente de la movilidad.' : 'La intención declarada de abandonar y los pensamientos de abandono no equivalen a deserción efectiva. La intención de matrícula tampoco es una probabilidad estimada por SAVRA. Los resultados no establecen causalidad, significación estadística, impacto ni capacidad predictiva. Una muestra pequeña, de autoinforme y por conveniencia limita la comparación entre instituciones.'],
    ['Fidelidad y versiones del instrumento', 'La exportación permite conservar textos y opciones observadas, pero no recuperar opciones nunca seleccionadas, ramificaciones ni obligatoriedad original de Forms. La versión savra-integrada-v2 completa los catálogos revisados; las demás opciones heredadas siguen pendientes de validación. Las preguntas cerradas son obligatorias; los textos de Otro solo se exigen al elegir esa opción y el comentario final es opcional. Las versiones registradas son inmutables. Las equivalencias entre instrumentos futuros requieren reglas explícitas y revisión de redacción, tipo y opciones.'],
    ['Almacenamiento y evolución futura', demo ? 'La versión del instrumento distingue la procedencia sintética. Los CSV contienen los mismos agregados protegidos que las tablas y marcan cada fila como simulación.' : 'PostgreSQL conserva origen y versión. La importación descarta nombres, correos y fechas administrativas originales. Los comentarios abiertos permanecen restringidos. El umbral reduce la divulgación, pero no garantiza anonimato absoluto frente a información externa o cambios temporales. El sistema admite futuros instrumentos y fuentes. Incorporarlos exige revisión de calidad, consentimiento y compatibilidad.']
  ]
  return <article className="methodology">
    <figure className="process-figure"><figcaption><h2>Del instrumento al observatorio</h2></figcaption>
      <ol role="list">{process.map(({ name, summary, icon: Icon }, i) => <li key={name}><Icon size={22} aria-hidden="true" /><strong>{name}</strong><small>{summary}</small>{i < process.length - 1 && <ArrowRight className="process-arrow" size={16} aria-hidden="true" />}</li>)}</ol>
    </figure>
    {sections.map(([title, text], i) => <section key={title}><span>{String(i + 1).padStart(2, '0')}</span><div><h2>{title}</h2><p>{text}</p></div></section>)}</article>
}

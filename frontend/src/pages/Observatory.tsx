import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, ChartNoAxesColumnIncreasing, Database, GraduationCap, Landmark, Layers3, Menu, RefreshCw, X } from 'lucide-react'
import { Brand, EmptyState, ErrorState, Loading } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { api, type AnalyticsData, type ChartData } from '@/lib/api'
import { MethodologyContent, Quality } from './ObservatoryContext'

import { ChartPanel } from '@/components/ChartPanel'
import { formatCount, formatPercent, scaleView } from '@/components/chartOptions'

export { ChartPanel } from '@/components/ChartPanel'

const modules = [
  { path: '/observatorio', label: 'Panorama general', icon: ChartNoAxesColumnIncreasing },
  { path: '/observatorio/academico', label: 'Exploración académica', icon: GraduationCap },
  { path: '/observatorio/permanencia', label: 'Indicadores de permanencia', icon: Layers3 },
  { path: '/observatorio/institucional', label: 'Análisis institucional', icon: Landmark },
  { path: '/observatorio/datos', label: 'Gestión de datos', icon: Database },
  { path: '/observatorio/metodologia', label: 'Metodología y alcance', icon: BookOpen }
]

export default function Observatory() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { search } = useLocation()
  return <div className="observatory">
    <aside className="sidebar"><div className="sidebar-brand"><Brand compact /><button type="button" className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Cerrar navegación' : 'Abrir navegación'} aria-expanded={menuOpen} aria-controls="observatory-nav">{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button></div>
      <nav id="observatory-nav" aria-label="Módulos del centro de observación" className={menuOpen ? 'module-nav open' : 'module-nav'}>{modules.map(({ path, label, icon: Icon }, i) => <NavLink key={path} to={{ pathname: path, search }} end={i === 0} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? 'module-link active' : 'module-link'}><Icon size={19} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><Link to="/"><ArrowLeft size={15} aria-hidden="true" />Volver al inicio</Link></div>
    </aside>
    <main className="observatory-main"><Outlet /></main>
  </div>
}

const descriptions: Record<string, { title: string; second: string; intro: string; endpoint: string }> = {
  overview: { title: 'Panorama', second: 'general.', intro: 'Resultados de la encuesta sobre continuidad universitaria.', endpoint: '/overview' },
  academic: { title: 'Exploración', second: 'académica.', intro: 'Cruces entre condiciones estudiantiles y pensamientos de abandono.', endpoint: '/analytics/academic' },
  permanence: { title: 'Indicadores de', second: 'permanencia.', intro: 'Condiciones y decisiones sobre la continuidad universitaria.', endpoint: '/analytics/permanence' },
  institutional: { title: 'Análisis', second: 'institucional.', intro: 'Resultados por universidad.', endpoint: '/analytics/institutional' },
  quality: { title: 'Gestión de', second: 'datos.', intro: 'Cobertura de las preguntas y procedencia de las respuestas.', endpoint: '/analytics/quality' },
  methodology: { title: 'Metodología', second: 'y alcance.', intro: 'Cómo se calculan, protegen e interpretan los resultados.', endpoint: '/analytics/methodology' }
}

function matrixReading(chart: ChartData) {
  if (chart.status !== 'ready' || !chart.data.length) return
  const peak = chart.data.reduce((max, cell) => cell.percentage > max.percentage ? cell : max)
  const ties = chart.data.filter(cell => cell.percentage === peak.percentage).length
  return `${ties > 1 ? 'Una de las celdas con el mayor porcentaje por fila' : 'El mayor porcentaje por fila'} corresponde a «${peak.category}» en «${peak.label}» (${formatPercent(peak.percentage)}, ${formatCount(peak.count)} de ${formatCount(peak.row_denominator ?? 0)}).`
}

function ChartCollection({ module, data, demo, onInstitution }: { module: string; data: AnalyticsData; demo: boolean; onInstitution: (value: string) => void }) {
  const { charts, composition, institutional_points: points } = data
  const selectable = data.filters.university
  const choices = module === 'academic' ? charts.filter(chart => !chart.key.startsWith('semester__')) : module === 'institutional' ? charts.slice(1) : []
  const [choice, setChoice] = useState(choices.find(c => c.status === 'ready')?.key ?? choices[0]?.key ?? '')
  if (module === 'overview') {
    const difficulty = charts.find(chart => chart.key === 'main_difficulty')
    const ever = composition?.status === 'ready' ? composition.data[1] : null
    const insight = ever && composition?.denominator != null
      ? `${formatCount(ever.count)} de ${formatCount(composition.denominator)} ${demo ? 'registros sintéticos válidos' : 'respuestas válidas'} (${formatPercent(ever.percentage)}) corresponden a quienes han pensado en abandonar al menos una vez.`
      : undefined
    return <div className="chart-grid chart-grid-overview">
      {charts.filter(chart => chart.key === 'dropout_thoughts').map(chart => <ChartPanel key={chart.key} chart={chart} view="donut" demo={demo} insight={insight} />)}
      {difficulty && <ChartPanel chart={difficulty} demo={demo} />}
      {charts.filter(chart => chart.key !== 'dropout_thoughts' && chart.key !== 'main_difficulty').map(chart =>
        <ChartPanel key={chart.key} chart={chart} view={scaleView(chart)} demo={demo} selectable={selectable} onInstitution={onInstitution} />)}
    </div>
  }
  if (!choices.length) return <div className="chart-grid">{charts.map(chart => <ChartPanel key={chart.key} chart={chart} view={scaleView(chart)} demo={demo} />)}</div>
  const selected = choices.find(c => c.key === choice) ?? choices[0]
  const semester = module === 'academic' ? charts.find(chart => chart.key === 'semester__dropout_thoughts') : null
  return <>
    {module === 'institutional' && <div className="chart-grid institutional-lead">
      {points && <ChartPanel chart={points} view="dot" demo={demo} selectable={selectable} onInstitution={onInstitution} />}
      <ChartPanel chart={charts[0]} demo={demo} selectable={selectable} onInstitution={onInstitution} />
    </div>}
    <div className="analysis-selector"><label htmlFor="analysis-dimension">{module === 'academic' ? 'Condición para comparar con pensamientos de abandono' : 'Dimensión para comparar entre universidades'}</label>
      <select id="analysis-dimension" value={selected.key} onChange={e => setChoice(e.target.value)}>{choices.map(c => <option key={c.key} value={c.key}>{c.title}</option>)}</select></div>
    <div className="chart-grid chart-grid-comparisons">
      <ChartPanel key={selected.key} chart={selected} view="heatmap" demo={demo} insight={matrixReading(selected)} />
      {semester && <ChartPanel chart={semester} view="stack" demo={demo} />}
    </div>
  </>
}

function Mobility({ mobility, choice, onChange, demo }: { mobility?: AnalyticsData['mobility']; choice: string; onChange: (key: string) => void; demo: boolean }) {
  if (mobility?.status !== 'ready') {
    return <p className="section-state">{mobility?.message ?? 'Todavía no se han recopilado datos de movilidad en este entorno.'}</p>
  }
  const selected = mobility.comparisons.find(chart => chart.key === choice)
    ?? mobility.comparisons.find(chart => chart.filterable) ?? mobility.comparisons.find(chart => chart.status === 'ready') ?? mobility.comparisons[0]
  return <section className="mobility-section" aria-labelledby="mobility-title">
    <header className="analysis-heading"><h2 id="mobility-title">Movilidad y apoyos</h2></header>
    <p className="section-state">{mobility.message}</p>
    <div className="chart-grid">
      {mobility.flow && <ChartPanel chart={mobility.flow} view="sankey" demo={demo} />}
      {mobility.charts.map(chart => <ChartPanel key={chart.key} chart={chart} view={scaleView(chart)} demo={demo} />)}
    </div>
    {selected && <section className="mobility-comparison">
      <header className="analysis-heading"><h2>Condiciones de movilidad y continuidad</h2></header>
      <div className="analysis-selector"><label htmlFor="mobility-comparison">Variable de movilidad para comparar</label><select id="mobility-comparison" value={selected.key} onChange={event => onChange(event.target.value)}>{mobility.comparisons.map(chart => <option key={chart.key} value={chart.key}>{chart.title}</option>)}</select></div>
      <ChartPanel key={selected.key} chart={selected} view="heatmap" demo={demo} insight={mobility.message} />
    </section>}
  </section>
}

export function AnalyticsModule({ module }: { module: string }) {
  const content = descriptions[module]
  const [params, setParams] = useSearchParams()
  const university = params.get('universidad') ?? ''
  const semester = params.get('semestre') ?? ''
  const [data, setData] = useState<AnalyticsData>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [completed, setCompleted] = useState('')
  const request = JSON.stringify([content.endpoint, university, semester, revision])
  const loading = completed !== request
  const results = useRef<HTMLDivElement>(null)
  const [dimension, setDimension] = useState<'academic' | 'mobility'>('academic')
  const [mobilityComparison, setMobilityComparison] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    results.current?.querySelector<HTMLDialogElement>('dialog[open]')?.close()
    setError('')
    const query = new URLSearchParams()
    if (university) query.set('university', university)
    if (semester) query.set('semester', semester)
    api<AnalyticsData>(`${content.endpoint}?${query}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setCompleted(request) })
    return () => controller.abort()
  }, [university, semester, content.endpoint, request])
  useEffect(() => { const refresh = () => { if (document.visibilityState === 'visible') setRevision(x => x + 1) }; const timer = window.setInterval(refresh, 60000); document.addEventListener('visibilitychange', refresh); return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) } }, [])
  function filter(key: string, value: string) { const next = new URLSearchParams(params); value ? next.set(key, value) : next.delete(key); setParams(next) }
  function selectInstitution(value: string) {
    if (!loading && value !== university && data?.filters.university.includes(value)) filter('universidad', value)
  }
  const demo = data?.data_mode === 'demo'
  const mobilitySelected = module === 'academic' && dimension === 'mobility'
  return <>
    <header className="workspace-header"><h1>{content.title} <span>{content.second}</span></h1><p>{content.intro}</p></header>
    <section className="filters" aria-label="Filtros de resultados">
      <div><label htmlFor="filter-university">Universidad</label><select id="filter-university" value={university} onChange={e => filter('universidad', e.target.value)} disabled={!data || loading}><option value="">Todas las universidades</option>{data?.filters.university.map(u => <option key={u}>{u}</option>)}{university && !data?.filters.university.includes(university) && <option value={university}>Selección no disponible</option>}</select></div>
      <div><label htmlFor="filter-semester">Semestre</label><select id="filter-semester" value={semester} onChange={e => filter('semestre', e.target.value)} disabled={!data || loading}><option value="">Todos los semestres</option>{data?.filters.semester.map(s => <option key={s}>{s}</option>)}{semester && !data?.filters.semester.includes(semester) && <option value={semester}>Selección no disponible</option>}</select></div>
      <div className="filter-actions"><Button variant="ghost" size="sm" onClick={() => setRevision(x => x + 1)} disabled={loading} aria-label="Actualizar resultados"><RefreshCw size={15} /><span>Actualizar</span></Button>{(university || semester) && <Button variant="ghost" size="sm" onClick={() => setParams({})}>Limpiar filtros</Button>}</div>
    </section>
    <div className="module-content" aria-busy={loading}>
      {loading && <div className={data ? 'query-overlay' : ''}><Loading text="Consultando resultados agregados…" /></div>}
      {!loading && error && <ErrorState message={error} retry={() => setRevision(x => x + 1)} />}
      <div ref={results} className="module-results" data-updating={loading || undefined} inert={loading}>
      {data && !error && <>
        <section className="metric-strip" aria-label={demo ? 'Resumen simulado de la selección' : 'Resumen de la selección'}>
          <div><p>{demo ? 'Registros sintéticos' : 'Respuestas elegibles'}</p><strong>{data.eligible_responses == null ? `1–${data.minimum_group_size - 1}` : formatCount(data.eligible_responses)}</strong>
            {data.eligible_responses == null && <span>Intervalo por privacidad</span>}</div>
          {module === 'quality' || module === 'methodology' ?
            <div><p>Cuestionario activo</p><strong className="version-value">{data.versions?.find(v => v.active)?.version ?? 'Sin versión'}</strong></div> :
            <div><p>{demo ? 'Categorías universitarias' : 'Universidades representadas'}</p><strong>{data.universities ?? '—'}</strong>{data.universities == null && <span>Recuento no disponible</span>}</div>}
        </section>
        {data.status !== 'ready' && <EmptyState title={data.status === 'empty' ? 'Aún no hay resultados' : 'Primeras participaciones'}><p>{data.message}</p></EmptyState>}
        {data.status === 'ready' && module === 'permanence' &&
          <section className="derived-grid" aria-label="Indicadores de permanencia">{data.indicators?.map(i => <article key={i.key}><h2>{i.title}</h2><strong>{i.status === 'ready' && i.percentage != null ? formatPercent(i.percentage) : '—'}</strong>
            {i.status === 'ready' && i.percentage != null && <div className="proportion-band" aria-hidden="true"><span style={{ width: `${i.percentage}%` }} /></div>}
            <p>{i.status === 'ready' ? `${i.count} de ${i.denominator} ${demo ? 'registros válidos' : 'respuestas válidas'}` : 'Conteo no disponible'}</p></article>)}</section>}
        {module !== 'academic' && data.charts.length > 0 && <ChartCollection key={module} module={module} data={data} demo={demo} onInstitution={selectInstitution} />}
        {module === 'academic' && <>
          <div className="dimension-control" role="group" aria-label="Dimensión de exploración">
            <button type="button" aria-pressed={!mobilitySelected} onClick={() => setDimension('academic')}>Condiciones académicas</button>
            <button type="button" aria-pressed={mobilitySelected} onClick={() => setDimension('mobility')}>Movilidad estudiantil</button>
          </div>
          {mobilitySelected ? <Mobility mobility={data.mobility} choice={mobilityComparison} onChange={setMobilityComparison} demo={demo} /> : data.charts.length > 0 && <ChartCollection module={module} data={data} demo={demo} onInstitution={selectInstitution} />}
        </>}
        {module === 'methodology' && <MethodologyContent demo={demo} filterNote={data.filter_note} minimumGroupSize={data.minimum_group_size} />}
        {module === 'quality' && <Quality data={data} />}
        {module === 'permanence' && !!data.indicators?.length && <details className="analysis-notes"><summary>Criterios de cálculo</summary>
          <dl>{data.indicators.map(indicator => <div key={indicator.key}><dt>{indicator.title}</dt><dd>{indicator.rule} {indicator.message}</dd></div>)}</dl>
        </details>}
      </>}
      </div>
    </div>
  </>
}

export function Overview() { return <AnalyticsModule module="overview" /> }
export function Methodology() { return <AnalyticsModule module="methodology" /> }

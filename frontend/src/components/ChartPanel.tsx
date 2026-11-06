import { lazy, Suspense, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import { Loading } from '@/components/shared'
import { SIMULATION_NOTICE, type ChartData } from '@/lib/api'
import { baseText, formatCount, formatPercent, viewInfo, type ChartView } from './chartOptions'
import { canOrderByFrequent, orderChart, orderLabels, type ChartOrder } from './chartOrder'

const DistributionChart = lazy(() => import('./DistributionChart'))

function CategoryCatalog({ chart }: { chart: ChartData }) {
  const catalogs = Object.values(chart.category_catalog ?? {})
  if (!catalogs.length) return null
  const published = new Set(chart.data.map(row => row.label))
  return <details className="data-table category-catalog"><summary>Ver categorías del cuestionario</summary>
    <p>{catalogs.length > 1 ? 'Opciones originales de las dos preguntas, en el orden del instrumento.' :
      'Opciones del instrumento. Las frecuencias publicables figuran en la tabla de la distribución.'}</p>
    {catalogs.map((labels, index) => <ol key={index} aria-label={catalogs.length > 1 ? `Pregunta ${index + 1}` : 'Opciones originales'}>
      {labels.map(label => <li key={label}>{label}{chart.status === 'ready' && chart.kind === 'distribution' && !published.has(label) && <span> · Frecuencia reservada</span>}</li>)}
    </ol>)}
  </details>
}

function ChartTable({ chart, view, demo }: { chart: ChartData; view: ChartView; demo: boolean }) {
  const matrix = chart.kind === 'matrix'
  const grouped = matrix || chart.kind === 'rates'
  const sankey = view === 'sankey'
  return <div className="table-scroll" role="region" aria-label={`Tabla de ${chart.title}`} tabIndex={0}><table>
    <caption>{chart.title} · base {formatCount(chart.denominator ?? 0)}{demo && ' · Datos simulados'}</caption>
    <thead><tr><th scope="col">{sankey ? 'Medio de transporte' : chart.kind === 'rates' ? 'Universidad' : matrix ? 'Grupo' : 'Categoría'}</th>
      {matrix && <th scope="col">{sankey ? 'Rango de tiempo' : 'Respuesta'}</th>}<th scope="col">{demo ? 'Registros' : 'Respuestas'}</th>
      {grouped && <th scope="col">Base del grupo</th>}<th scope="col">{grouped ? '% del grupo' : '% de la base'}</th></tr></thead>
    <tbody>{chart.data.map(d => <tr key={JSON.stringify([d.label, d.category])}><th scope="row">{d.label}</th>
      {matrix && <td>{d.category}</td>}<td>{formatCount(d.count)}</td>{grouped && <td>{formatCount(d.row_denominator ?? 0)}</td>}<td>{formatPercent(d.percentage)}</td></tr>)}</tbody>
    {chart.reference && <tfoot><tr><th scope="row">{chart.reference.label}</th><td>{formatCount(chart.reference.count)}</td><td>{formatCount(chart.reference.row_denominator ?? 0)}</td><td>{formatPercent(chart.reference.percentage)}</td></tr></tfoot>}
  </table></div>
}

function downloadSimulation(chart: ChartData) {
  const rows = [
    ['Procedencia', 'Visualización', 'Categoría', 'Respuesta', 'Frecuencia', 'Denominador', 'Porcentaje'],
    ...[...chart.data, ...(chart.reference ? [chart.reference] : [])].map(d =>
      [SIMULATION_NOTICE, chart.title, d.label, d.category ?? '', d.count, d.row_denominator ?? chart.denominator, d.percentage])
  ]
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `savra-datos-simulados-${chart.key}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function unavailableTitle(chart: ChartData) {
  return chart.status === 'unavailable' ? 'Variable no disponible' : 'Frecuencias reservadas'
}

function ExpandedChart({ chart, view, demo, insight, order, onClose }: {
  chart: ChartData; view: ChartView; demo: boolean; insight?: string
  order?: { value: ChartOrder; onChange: (value: ChartOrder) => void }; onClose: () => void
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    close.current?.focus()
    return () => { if (element.open) element.close() }
  }, [])
  const ready = chart.status === 'ready'
  const basis = view === 'sankey' ? 'Cada porcentaje usa las respuestas conjuntas válidas del medio de transporte.'
    : chart.kind === 'matrix' ? 'Cada porcentaje usa las respuestas conjuntas válidas de su fila.' : view === 'dot'
      ? 'Cada porcentaje usa las respuestas válidas de la universidad.' : 'Porcentaje sobre respuestas válidas de esta pregunta.'
  return <dialog className="chart-dialog" ref={dialog} onClose={() => { if (!dialog.current?.open) onClose() }} aria-labelledby={id}>
    <header><div><p className="panel-kicker">{demo && <span className="simulation-tag">Simulación</span>}{ready ? viewInfo[view].name : 'Disponibilidad'}</p>
      <h2 id={id}>{chart.title}</h2></div><button className="close-chart" type="button" ref={close} aria-label="Cerrar gráfico ampliado" onClick={() => dialog.current?.close()}><X size={22} aria-hidden="true" /></button></header>
    {ready ? <>
      <p className="chart-base">{baseText(chart, demo, view)}</p>
      {order && <label className="chart-order">Orden del gráfico
        <select value={order.value} onChange={event => order.onChange(event.target.value === 'frequent' ? 'frequent' : 'default')}>
          <option value="frequent">{orderLabels.frequent}</option>
          <option value="default">{orderLabels.default}</option>
        </select>
      </label>}
      <Suspense fallback={<Loading text="Preparando visualización…" />}>
        <DistributionChart chart={chart} view={view} demo={demo} orderLabel={order && orderLabels[order.value]} expanded
          onCsv={demo ? () => downloadSimulation(chart) : undefined} />
      </Suspense>
      <ChartTable chart={chart} view={view} demo={demo} />
    </> : <><h3 className="chart-detail-status">{unavailableTitle(chart)}</h3><p className="chart-rationale">{chart.message}</p></>}
    <details className="chart-definition"><summary>Pregunta y criterio de cálculo</summary>
      {chart.definition && <p>{chart.definition}</p>}
      <p>{basis}</p>
      {ready && <p>{viewInfo[view].reason}</p>}
      {insight && <p>{insight}</p>}
      {!!chart.missing && <p>La cobertura es parcial. Los porcentajes describen solo las respuestas compatibles de esta pregunta o cruce.</p>}
      {chart.grouping_note && <p>{chart.grouping_note}</p>}
      {ready && chart.message && <p>{chart.message}</p>}
      {chart.filterable === false && <p>La subdivisión por filtros puede estar restringida.</p>}
    </details>
    <CategoryCatalog chart={chart} />
  </dialog>
}

export function ChartPanel({ chart, demo = false, view = chart.kind === 'matrix' ? 'stack' : 'bars', insight, selectable, onInstitution }: {
  chart: ChartData; demo?: boolean; view?: ChartView; insight?: string; selectable?: string[]; onInstitution?: (value: string) => void
}) {
  const heading = useId()
  const expand = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [preferredOrder, setPreferredOrder] = useState<ChartOrder>('frequent')
  const orderEnabled = view === 'stack' && canOrderByFrequent(chart)
  const order = orderEnabled ? preferredOrder : 'default'
  const shown = useMemo(() => orderChart(chart, view, order), [chart, view, order])
  const ready = chart.status === 'ready'
  const action = ready ? 'Ampliar gráfico' : 'Ver detalle'
  return <section className={`chart-panel chart-panel-${chart.key}`} aria-labelledby={heading}>
    <h2 id={heading}>{chart.title}</h2>
    {ready ? <>
      {chart.denominator != null && <p className="chart-base">{baseText(chart, demo, view, true)}</p>}
      <Suspense fallback={<Loading text="Preparando visualización…" />}><DistributionChart chart={shown} view={view} demo={demo} selectable={selectable} onInstitution={onInstitution} /></Suspense>
    </> : <p className="chart-state">{unavailableTitle(chart)}</p>}
    <div className="chart-actions">
      <button ref={expand} type="button" className="export-link" aria-haspopup="dialog" aria-label={`${action}: ${chart.title}`} onClick={() => setExpanded(true)}>
        <Maximize2 size={15} aria-hidden="true" /> {action}
      </button>
    </div>
    {expanded && <ExpandedChart chart={shown} view={view} demo={demo} insight={insight}
      order={orderEnabled ? { value: order, onChange: setPreferredOrder } : undefined}
      onClose={() => { setExpanded(false); expand.current?.focus() }} />}
  </section>
}

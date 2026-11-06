import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart, PieChart, SankeyChart, ScatterChart } from 'echarts/charts'
import { GraphicComponent, GridComponent, MarkLineComponent, TooltipComponent, VisualMapContinuousComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { Download, Info } from 'lucide-react'
import { SIMULATION_NOTICE, type ChartData } from '@/lib/api'
import { baseText, chartHeight, chartLegend, chartVariables, formatCount, formatPercent, makeChartOption, viewInfo, wrapLabel, type ChartView } from './chartOptions'
import { categoryColor, chartColors, hasCategoryColors } from './chartPalette'

echarts.use([BarChart, HeatmapChart, PieChart, SankeyChart, ScatterChart, GraphicComponent, GridComponent,
  MarkLineComponent, TooltipComponent, VisualMapContinuousComponent, SVGRenderer])

const NO_INSTITUTIONS: string[] = []
const svgNamespace = 'http://www.w3.org/2000/svg'
const { graphite: GRAPHITE, surface: SURFACE } = chartColors

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function referenceText(chart: ChartData) {
  const ref = chart.reference
  return ref ? `${ref.label} · ${formatPercent(ref.percentage)} (${formatCount(ref.count)} de ${formatCount(ref.row_denominator ?? 0)})` : ''
}

function exportSvg(chart: ChartData, view: ChartView, demo: boolean, orderLabel?: string) {
  const width = 920
  const chartWidth = width - 48
  const height = chartHeight(chart, view, false)
  const instance = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: chartWidth, height })
  let plot: SVGSVGElement
  try {
    instance.setOption(makeChartOption({ chart, view, demo, narrow: false, motion: false, highlight: '', selectable: [] }))
    const xml = new DOMParser().parseFromString(instance.renderToSVGString(), 'image/svg+xml')
    plot = xml.documentElement as unknown as SVGSVGElement
  } finally {
    instance.dispose()
  }

  const root = document.createElementNS(svgNamespace, 'svg')
  const title = document.createElementNS(svgNamespace, 'title')
  const backdrop = document.createElementNS(svgNamespace, 'rect')
  root.setAttribute('width', String(width))
  title.textContent = chart.title
  root.append(title, backdrop)
  backdrop.setAttribute('fill', SURFACE)
  backdrop.setAttribute('width', '100%')
  backdrop.setAttribute('height', '100%')

  let y = 32
  function addText(value: string, size: number, color = GRAPHITE, x = 24) {
    const element = document.createElementNS(svgNamespace, 'text')
    element.setAttribute('x', String(x))
    element.setAttribute('y', String(y))
    element.setAttribute('fill', color)
    element.setAttribute('font-family', 'Arial, sans-serif')
    element.setAttribute('font-size', String(size))
    element.textContent = value
    root.append(element)
  }
  addText(demo ? `SAVRA · ${SIMULATION_NOTICE}` : 'SAVRA · Observatorio', 13)
  y += 31
  for (const line of wrapLabel(chart.title, 68).split('\n')) { addText(line, 23); y += 27 }
  for (const line of wrapLabel(baseText(chart, demo, view), 110).split('\n')) { addText(line, 13); y += 18 }
  if (orderLabel) { addText(`Orden · ${orderLabel}`, 13); y += 19 }
  if (view === 'sankey') { addText('Medio de transporte → Rango de tiempo', 13); y += 19 }
  plot.setAttribute('x', '24')
  plot.setAttribute('y', String(y))
  root.append(plot)
  y += height + 16
  for (const { label, color, value } of chartLegend(chart, view)) {
    const swatch = document.createElementNS(svgNamespace, 'rect')
    swatch.setAttribute('x', '24')
    swatch.setAttribute('y', String(y - 10))
    swatch.setAttribute('width', '11')
    swatch.setAttribute('height', '11')
    swatch.setAttribute('fill', color)
    swatch.setAttribute('stroke', chartColors.muted)
    root.append(swatch)
    addText(value == null ? label : `${label} · ${formatPercent(value)}`, 13, GRAPHITE, 42)
    y += 19
  }
  if (chart.reference) { addText(`Línea discontinua · ${referenceText(chart)}`, 13); y += 19 }
  if (chart.grouping_note || view === 'donut') {
    for (const line of wrapLabel(chart.definition ?? '', 115).split('\n')) { addText(line, 12); y += 16 }
  }
  root.setAttribute('height', String(y + 9))
  return { svg: new XMLSerializer().serializeToString(root), width, height: y + 9 }
}

async function downloadChart(chart: ChartData, view: ChartView, demo: boolean, format: 'svg' | 'png', orderLabel?: string) {
  const { svg, width, height } = exportSvg(chart, view, demo, orderLabel)
  const name = `savra-${demo ? 'simulacion-' : ''}${chart.key}.${format}`
  if (format === 'svg') {
    download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), name)
    return
  }
  const bitmap = new Image()
  bitmap.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await bitmap.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  const context = canvas.getContext('2d')
  if (!context) throw new Error('PNG')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG')
  download(blob, name)
}

export default function DistributionChart({ chart, view = 'bars', demo = false, expanded = false, orderLabel, selectable = NO_INSTITUTIONS, onInstitution, onCsv }: {
  chart: ChartData; view?: ChartView; demo?: boolean; expanded?: boolean; orderLabel?: string; selectable?: string[]
  onInstitution?: (value: string) => void; onCsv?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const instance = useRef<echarts.EChartsType | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [highlight, setHighlight] = useState('')
  const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [exportError, setExportError] = useState(false)
  const legend = chartLegend(chart, view)
  const visibleHighlight = legend.some(({ label }) => label === highlight) ? highlight : ''

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setMotion(!query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const element = ref.current!
    const plot = echarts.init(element, undefined, { renderer: 'svg' })
    instance.current = plot
    const resize = () => {
      if (!element.clientWidth) return
      setNarrow(element.clientWidth < 505)
      plot.resize({ animation: { duration: 0 } })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => { observer.disconnect(); plot.dispose(); instance.current = null }
  }, [])
  useEffect(() => {
    const plot = instance.current!
    plot.setOption(makeChartOption({ chart, view, narrow, demo, motion, highlight: visibleHighlight, selectable }), {
      replaceMerge: ['series', 'graphic', 'xAxis', 'yAxis', 'visualMap'],
    })
  }, [chart, view, narrow, demo, motion, visibleHighlight, selectable])
  useEffect(() => {
    const plot = instance.current!
    function select(event: unknown) {
      const data = (event as { data?: { focus?: string; institution?: string } }).data
      if (data?.institution && selectable.includes(data.institution)) onInstitution?.(data.institution)
      else if (data?.focus) setHighlight(current => current === data.focus ? '' : data.focus ?? '')
    }
    plot.on('click', select)
    return () => { plot.off('click', select) }
  }, [onInstitution, selectable])

  const columns = chart.columns ?? []
  const [, column] = chartVariables(chart)
  async function exportAs(format: 'svg' | 'png') {
    setExportError(false)
    try { await downloadChart(chart, view, demo, format, orderLabel) }
    catch { setExportError(true) }
  }

  return <div className={`chart-visual chart-view-${view}`}>
    {view === 'sankey' && <div className="flow-directions"><span>Medio de transporte</span><span>Rango de tiempo</span></div>}
    <div className="echart" ref={ref} role="img" aria-label={`${demo ? 'Simulación. ' : ''}${viewInfo[view].name}. ${chart.title}. ${baseText(chart, demo, view, !expanded)} ${expanded ? 'Frecuencias y porcentajes disponibles en la tabla.' : 'Consulta los datos al ampliar el gráfico.'}`}
      style={{ height: chartHeight(chart, view, narrow) }} data-view={view} data-motion={motion ? 'normal' : 'reducido'}
      data-testid={`${expanded ? 'expanded-' : ''}chart-${chart.key}`} />
    {view === 'heatmap' && narrow && columns.length > 2 && <ol className="chart-axis-key" role="list" aria-label="Clave de columnas">{columns.map((label, i) =>
      <li key={label}>{hasCategoryColors(column) && <i aria-hidden="true" style={{ backgroundColor: categoryColor(column, label) }} />}<strong>{i + 1}</strong> {label}</li>)}</ol>}
    {chart.reference && <p className="chart-reference"><span aria-hidden="true" />{referenceText(chart)}</p>}
    {legend.length > 0 && <ul className="chart-legend" aria-label="Categorías del gráfico">{legend.map(({ label, color, value }) =>
      <li key={label}><button type="button" aria-label={`Resaltar ${label}${value == null ? '' : `, ${formatPercent(value)}`}`}
        aria-pressed={visibleHighlight === label} onClick={() => setHighlight(visibleHighlight === label ? '' : label)}>
        <i aria-hidden="true" style={{ backgroundColor: color }} />{label}{value != null && <strong>{formatPercent(value)}</strong>}
      </button></li>)}</ul>}
    {expanded && <div className="image-exports">
      <button type="button" className="export-link" onClick={() => void exportAs('png')}><Download size={15} aria-hidden="true" /> Exportar PNG</button>
      <button type="button" className="export-link" onClick={() => void exportAs('svg')}><Download size={15} aria-hidden="true" /> Exportar SVG</button>
      {onCsv && <button type="button" className="export-link" onClick={onCsv} aria-label={`Descargar CSV simulado: ${chart.title}`}>
        <Download size={15} aria-hidden="true" /> CSV simulado
      </button>}
      {exportError && <p className="privacy-note" role="alert"><Info size={14} aria-hidden="true" />No se pudo descargar la imagen.</p>}
    </div>}
  </div>
}

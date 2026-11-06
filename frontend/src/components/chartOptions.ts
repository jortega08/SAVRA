import type { EChartsCoreOption } from 'echarts/core'
import type { ChartData, ChartDatum } from '@/lib/api'
import { categoryColor, chartColors, hasCategoryColors, hasDirectionalScale, heatColors, heatTextColor, protectedCategory, scaleLevel } from './chartPalette'

export type ChartView = 'bars' | 'stack' | 'heatmap' | 'donut' | 'likert' | 'dot' | 'sankey'
const { graphite: GRAPHITE, surface: SURFACE, muted: MUTED, pearl: GRID, tomato: TOMATO, warmDark: WARM_DARK } = chartColors

export const formatCount = (value: number) => value.toLocaleString('es-CO')
export const formatPercent = (value: number) => `${value.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`

export const viewInfo: Record<ChartView, { name: string; reason: string }> = {
  bars: { name: 'Barras horizontales', reason: 'La longitud desde cero permite comparar las frecuencias de las categorías publicables.' },
  stack: { name: 'Barras al 100 %', reason: 'Cada barra ocupa el mismo ancho para comparar la composición de los grupos aunque tengan bases distintas.' },
  heatmap: { name: 'Mapa de calor', reason: 'El relleno de la celda y su etiqueta muestran el porcentaje por fila en una escala común de 0 a 100 %. Los recuadros junto a los ejes identifican categorías.' },
  donut: { name: 'Dona de composición', reason: 'Cada segmento usa la base de respuestas válidas de la pregunta. La reserva de privacidad se distingue en gris cuando corresponde.' },
  likert: { name: 'Likert divergente', reason: 'Los niveles bajos quedan a la izquierda y los altos a la derecha. El nivel central se reparte visualmente en dos mitades. La reserva de privacidad se indica en la leyenda sin ubicarla en la escala.' },
  dot: { name: 'Comparación por puntos', reason: 'Todos los puntos comparan la misma proporción en una escala de 0 a 100 %. La referencia, cuando está disponible, usa el total de casos sobre el total de respuestas válidas.' },
  sankey: { name: 'Flujos de movilidad', reason: 'El grosor de cada flujo representa registros conjuntos entre el medio de transporte y el rango de tiempo. El porcentaje de cada flujo usa la base de su medio.' },
}

export function scaleView(chart: ChartData): ChartView {
  return hasDirectionalScale(chart.key) && chart.ordered_categories?.length ? 'likert' : 'bars'
}

export function wrapLabel(label: string, limit: number) {
  const lines: string[] = []
  for (const word of label.split(' ')) {
    const last = lines.at(-1)
    if (last && last.length + word.length + 1 <= limit) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines.join('\n')
}

export function chartVariables(chart: ChartData) {
  return chart.required_variables ?? chart.key.split('__')
}

export function chartLegend(chart: ChartData, view: ChartView) {
  const [variable, column] = chartVariables(chart)
  if (view === 'stack') return (chart.columns ?? []).map(label => ({ label, color: categoryColor(column, label), value: undefined }))
  if (view === 'donut') return chart.data.map(row => ({ label: row.label, color: categoryColor(variable, row.label), value: row.percentage }))
  if (view === 'likert') return chart.data.map(({ label, percentage }) => ({
    label, color: categoryColor(variable, label), value: percentage,
  }))
  return []
}

export function chartHeight(chart: ChartData, view: ChartView, narrow: boolean) {
  if (view === 'donut') return 248
  if (view === 'likert') return 106
  if (view === 'sankey') return chart.rows && chart.rows.length > 3 ? 355 : 272
  if (view === 'heatmap') return Math.max(222, (chart.rows?.length ?? 0) * (narrow ? 61 : 49) + 103)
  return Math.max(174, (chart.rows?.length || chart.data.length) * (view === 'dot' ? 72 : narrow ? 47 : 39) + 48)
}

export function baseText(chart: ChartData, demo: boolean, view: ChartView, compact = false) {
  const count = formatCount(chart.denominator ?? 0)
  if (compact) return `n = ${count} ${demo ? 'registros válidos' : 'respuestas válidas'}${chart.kind === 'matrix' && view !== 'sankey' ? ' · % por fila' : ''}`
  const unit = demo ? 'registros sintéticos válidos' : 'respuestas válidas'
  const coverage = chart.coverage_percentage == null ? '' : ` · ${formatPercent(chart.coverage_percentage)} de cobertura`
  const missing = chart.missing ? ` · ${formatCount(chart.missing)} sin valor compatible` : ''
  const explanation = view === 'sankey' ? ' Recuentos en los flujos.' : chart.kind === 'matrix' ? ' Porcentajes por fila.' : view === 'dot' ? ' Porcentajes por universidad.' : ''
  return `Base de la selección: ${count} ${unit}${coverage}${missing}.${explanation}`
}

type Mark = { row?: ChartDatum; focus?: string; institution?: string }
type Hover = { data?: Mark; marker?: string }
type Setup = { chart: ChartData; view: ChartView; narrow: boolean; demo: boolean; motion: boolean; highlight: string; selectable: string[] }

function tooltipText(row: ChartDatum, chart: ChartData, demo: boolean) {
  const label = wrapLabel(row.label, 28)
  const category = row.category ? `\n${wrapLabel(row.category, 28)}` : ''
  return `${demo ? 'Simulación\n' : ''}${label}${category}\n${formatCount(row.count)} de ${formatCount(row.row_denominator ?? chart.denominator ?? 0)} · ${formatPercent(row.percentage)}`
}

function valueAxis(name: string, narrow: boolean, percent = false, min = 0) {
  return { type: 'value', id: 'value', name, min, max: percent ? 100 : undefined, minInterval: 1, splitNumber: narrow ? 4 : 5,
    interval: percent ? (min < 0 ? 50 : 25) : undefined, nameLocation: 'middle', nameGap: 27,
    nameTextStyle: { fontSize: 11, color: MUTED }, axisLabel: { color: MUTED, fontSize: 10, hideOverlap: true,
      formatter: (n: number) => percent ? formatPercent(Math.abs(n)) : formatCount(n) },
    splitLine: { lineStyle: { color: GRID } } }
}

function categoryAxis(labels: string[], narrow: boolean, formatter = (label: string) => wrapLabel(label, narrow ? 17 : 25)) {
  return { type: 'category', id: 'category', inverse: true, data: labels, axisTick: { show: false }, axisLine: { show: false },
    axisLabel: { interval: 0, formatter, fontSize: 11, lineHeight: 13, color: GRAPHITE, margin: 9 } }
}

function heatAxis(variable: string, labels: string[], narrow: boolean, format = (label: string) => wrapLabel(label, narrow ? 17 : 25)) {
  const axis = categoryAxis(labels, narrow, format)
  if (!hasCategoryColors(variable)) return axis
  const rich = Object.fromEntries(labels.map((label, index) => [`color${index}`, {
    backgroundColor: categoryColor(variable, label), width: 7, height: 7, borderRadius: 1, borderWidth: 1, borderColor: MUTED,
  }]))
  return { ...axis, axisLabel: { ...axis.axisLabel, rich,
    formatter: (label: string) => `{color${labels.indexOf(label)}| }\u00a0\u00a0${format(label)}`,
  } }
}

const standardGrid = { top: 8, bottom: 35, left: 0, right: 45, containLabel: true }
const referenceLine = (xAxis: number, dashed = false) => ({
  silent: true, symbol: 'none', label: { show: false },
  lineStyle: { color: MUTED, type: dashed ? 'dashed' : 'solid', width: 1.5 },
  data: [{ xAxis }],
})
const withOpacity = (color: string, highlight: string, label: string) => ({ color, opacity: !highlight || label === highlight ? 1 : 0.28 })

export function makeChartOption({ chart, view, narrow, demo, motion, highlight, selectable }: Setup): EChartsCoreOption {
  const common: EChartsCoreOption = {
    animation: motion, animationDuration: 300, animationDurationUpdate: 300,
    animationEasing: 'cubicOut', animationEasingUpdate: 'cubicInOut',
    color: [GRAPHITE],
    textStyle: { fontFamily: 'Manrope Variable, Arial, sans-serif', color: GRAPHITE },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, transitionDuration: motion ? 0.22 : 0,
      textStyle: { color: GRAPHITE }, backgroundColor: SURFACE,
      formatter: ({ data, marker }: Hover) => data?.row ? (marker ? `${marker} ` : '') + tooltipText(data.row, chart, demo) + (data.institution ? '\nFiltrar por esta universidad' : '') : '' },
  }
  const [variable, column] = chartVariables(chart)
  const rows = chart.rows ?? []
  const columns = chart.columns ?? []
  const exactPercent = (d: ChartDatum) => d.count * 100 / (d.row_denominator ?? chart.denominator ?? 1)

  if (view === 'donut') {
    const legend = chartLegend(chart, view)
    return { ...common,
      graphic: [
        { type: 'text', left: 'center', top: '40%', silent: true, style: { text: formatCount(chart.denominator ?? 0), fill: WARM_DARK, font: '800 32px Manrope Variable, Arial' } },
        { type: 'text', left: 'center', top: '56%', silent: true, style: { text: 'Respuestas válidas', fill: MUTED, font: '600 12px Manrope Variable, Arial' } },
      ],
      series: [{ type: 'pie', id: chart.key, radius: ['64%', '87%'], center: ['50%', '50%'], startAngle: 90,
        label: { show: false }, stillShowZeroSum: false, emphasis: { scaleSize: 5 },
        data: chart.data.map((row, i) => ({ name: row.label, value: row.count, row, focus: row.label,
          itemStyle: { ...withOpacity(legend[i].color, highlight, row.label), borderColor: SURFACE, borderWidth: 3, borderRadius: 4 },
          emphasis: { itemStyle: { color: legend[i].color } } })) }],
    }
  }

  if (view === 'heatmap') {
    const indexed = narrow && columns.length > 2
    return { ...common,
      grid: { ...standardGrid, right: 5, bottom: 65 },
      xAxis: { ...heatAxis(column, columns, narrow, label => indexed ? String(columns.indexOf(label) + 1) : wrapLabel(label, narrow ? 16 : 23)), inverse: false },
      yAxis: heatAxis(variable, rows, narrow),
      visualMap: { type: 'continuous', min: 0, max: 100, dimension: 2, seriesIndex: 0, orient: 'horizontal', left: 'center', bottom: 7,
        calculable: false, itemWidth: 11, itemHeight: narrow ? 95 : 140, text: ['100 %', '0 %'], textStyle: { color: MUTED, fontSize: 11 },
        inRange: { color: heatColors } },
      series: [{ type: 'heatmap', id: 'heatmap', emphasis: { itemStyle: { borderColor: GRAPHITE, borderWidth: 2 } },
        label: { show: true, fontSize: narrow ? 10 : 12, fontWeight: 'bold', formatter: ({ data }: Hover) => formatPercent(data?.row?.percentage ?? 0) },
        data: chart.data.map(row => ({ value: [columns.indexOf(row.category ?? ''), rows.indexOf(row.label), row.percentage], row,
          label: { color: heatTextColor(row.percentage) }, itemStyle: { borderWidth: 2, borderColor: SURFACE },
          tooltip: { borderColor: categoryColor(column, row.category ?? '') } })) }],
    }
  }

  if (view === 'stack') {
    return { ...common, grid: { ...standardGrid, right: 14 }, xAxis: valueAxis('Porcentaje del grupo', narrow, true), yAxis: categoryAxis(rows, narrow),
      series: chartLegend(chart, view).map(({ label, color }) => ({ name: label, id: label, type: 'bar', stack: 'responses', barMaxWidth: 25,
        emphasis: { focus: 'series' },
        data: rows.map(group => {
          const row = chart.data.find(d => d.label === group && d.category === label)!
          return { id: group, name: group, value: exactPercent(row), row, focus: label,
            itemStyle: withOpacity(color, highlight, label),
            emphasis: { itemStyle: { color } } }
        }) })),
    }
  }

  if (view === 'likert') {
    const byLevel = new Map(chart.data.filter(row => row.label !== protectedCategory).map(row => [scaleLevel(row.label), row]))
    const sides = [{ level: 3, factor: -0.5 }, { level: 3, factor: 0.5 }, { level: 2, factor: -1 }, { level: 1, factor: -1 }, { level: 4, factor: 1 }, { level: 5, factor: 1 }]
    return { ...common, grid: { top: 16, bottom: 33, left: 19, right: 19 },
      xAxis: valueAxis('Niveles bajos                  Niveles altos', narrow, true, -100),
      yAxis: { type: 'category', data: ['Escala'], show: false },
      series: sides.filter(({ level }) => byLevel.has(level)).map(({ level, factor }) => {
        const row = byLevel.get(level)!
        const color = categoryColor(variable, row.label)
        return { type: 'bar', id: `${level}:${factor}`, stack: 'scale', barMaxWidth: 30,
          markLine: factor === 0.5 ? referenceLine(0) : undefined, emphasis: { focus: 'series', itemStyle: { color } },
          data: [{ value: exactPercent(row) * factor, row, focus: row.label,
            itemStyle: withOpacity(color, highlight, row.label) }] }
      }),
    }
  }

  if (view === 'dot') {
    const labels = chart.data.map(d => d.label)
    return { ...common, grid: { ...standardGrid, right: 45 }, xAxis: valueAxis('Porcentaje de respuestas válidas', narrow, true),
      yAxis: categoryAxis(labels, narrow, label => `${wrapLabel(label, narrow ? 19 : 28)}\nn = ${formatCount(chart.data.find(row => row.label === label)?.row_denominator ?? 0)}`),
      series: [{ type: 'scatter', id: 'rates', symbolSize: 11, itemStyle: { color: WARM_DARK, opacity: 1 }, emphasis: { scale: 1.4, itemStyle: { color: WARM_DARK } },
        markLine: chart.reference ? referenceLine(exactPercent(chart.reference), true) : undefined,
        label: { show: true, position: 'right', color: GRAPHITE, fontSize: 11, formatter: ({ data }: Hover) => formatPercent(data?.row?.percentage ?? 0) },
        data: chart.data.map(row => ({ value: [exactPercent(row), row.label], row,
          institution: selectable.includes(row.label) ? row.label : undefined })) }],
    }
  }

  if (view === 'sankey') {
    const node = (name: string, side: 'left' | 'right') => {
      const count = chart.data.filter(row => (side === 'left' ? row.label : row.category) === name).reduce((sum, row) => sum + row.count, 0)
      return { name: `${side}:${name}`, row: { label: name, count, percentage: count * 100 / (chart.denominator ?? 1) },
        label: { position: side === 'left' ? 'right' : 'left', formatter: wrapLabel(name, narrow ? 13 : 25) },
        itemStyle: { color: categoryColor(side === 'left' ? variable : column, name), borderColor: MUTED, borderWidth: 1 } }
    }
    return { ...common, series: [{ type: 'sankey', id: 'flows', left: 8, right: 8, top: 12, bottom: 16,
      layoutIterations: 0, nodeWidth: narrow ? 10 : 16, nodeGap: 16, draggable: false, emphasis: { focus: 'adjacency' },
      label: { color: GRAPHITE, backgroundColor: SURFACE, padding: [4, 6], borderRadius: 3, fontSize: narrow ? 10 : 12, fontWeight: 'bold' },
      lineStyle: { color: 'source', opacity: 0.62, borderColor: SURFACE, borderWidth: 2, curveness: 0.49 },
      data: [...rows.map(name => node(name, 'left')), ...columns.map(name => node(name, 'right'))],
      links: chart.data.filter(row => row.count > 0).map(row => ({ source: `left:${row.label}`, target: `right:${row.category}`, value: row.count, row,
        tooltip: { borderColor: categoryColor(variable, row.label) } })),
    }] }
  }

  const data = chart.data
  return { ...common, grid: standardGrid, xAxis: valueAxis(demo ? 'Registros sintéticos' : 'Respuestas', narrow),
    yAxis: categoryAxis(data.map(d => d.label), narrow),
    series: [{ type: 'bar', id: chart.key, barMaxWidth: 20,
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      data: data.map(row => {
        const color = categoryColor(variable, row.label, TOMATO)
        return { id: row.label, name: row.label, value: row.count, row,
          itemStyle: { color },
          emphasis: { itemStyle: { color } },
          institution: chart.key === 'university' && selectable.includes(row.label) ? row.label : undefined }
      }),
      label: { show: true, position: 'right', color: GRAPHITE, fontSize: 11, formatter: ({ data }: Hover) => formatPercent(data?.row?.percentage ?? 0) } }],
  }
}

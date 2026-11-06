import { expect, test } from 'vitest'
import { chartLegend, makeChartOption, scaleView, type ChartView } from '@/components/chartOptions'
import { canOrderByFrequent, orderChart } from '@/components/chartOrder'
import { categoryColor, chartColors, heatColors, heatTextColor, protectedCategory } from '@/components/chartPalette'
import type { ChartData, ChartDatum } from '@/lib/api'

const scale: ChartData = {
  key: 'economic_difficulty', title: 'Dificultad económica', status: 'ready', denominator: 40, missing: 0, pooled: false, message: null,
  ordered_categories: ['1 - Ninguna', '2 - Poca', '3 - Moderada', '4 - Bastante', '5 - Mucha'],
  data: ['1 - Ninguna', '2 - Poca', '3 - Moderada', '4 - Bastante', '5 - Mucha'].map((label, i) =>
    ({ label, count: [5, 7, 12, 8, 8][i], percentage: [12.5, 17.5, 30, 20, 20][i] })),
}

function options(chart: ChartData, view: ChartView) {
  return makeChartOption({ chart, view, narrow: false, demo: false, motion: false, highlight: '', selectable: [] })
}

type Segment = { data: [{ value: number; row: ChartDatum; itemStyle: { color: string } }] }

test('Likert centra el nivel intermedio sin reducir su frecuencia ni modificar la base', () => {
  const option = options(scale, 'likert')
  expect(option.animation).toBe(false)
  expect(option.animationDurationUpdate).toBe(300)
  const series = option.series as Segment[]
  const segments = series.map(s => s.data[0])
  expect(segments.map(s => s.value)).toEqual([-15, 15, -17.5, -12.5, 20, 20])
  expect(segments.slice(0, 2).map(s => s.row.count)).toEqual([12, 12])
  expect(segments.reduce((sum, s) => sum + Math.abs(s.value), 0)).toBe(100)
  const formatter = (option.tooltip as { formatter: (args: { data: Segment['data'][0] }) => string }).formatter
  expect(formatter({ data: segments[0] })).toContain('12 de 40 · 30 %')
  const support = options({ ...scale, key: 'institutional_support' }, 'likert').series as Segment[]
  expect(segments.at(-1)?.itemStyle.color).toBe(support[3].data[0].itemStyle.color)
})

test('Likert distingue un cero publicable de una frecuencia reservada', () => {
  const motivation = { ...scale, key: 'motivation', ordered_categories: scale.ordered_categories?.slice(1), data: scale.data.slice(1) }
  expect(scaleView(motivation)).toBe('likert')
  expect(options(motivation, 'likert').series).toHaveLength(5)
  const [zero, withheld, ...published] = motivation.data
  const pooled = { ...motivation, pooled: true, data: [
    { ...zero, count: 0, percentage: 0 }, ...published,
    { label: protectedCategory, count: zero.count + withheld.count, percentage: zero.percentage + withheld.percentage },
  ] }
  expect(scaleView(pooled)).toBe('likert')
  expect(chartLegend(pooled, 'likert').find(item => item.label === zero.label)?.value).toBe(0)
  expect(chartLegend(pooled, 'likert').some(item => item.label === withheld.label)).toBe(false)
  expect((options(pooled, 'likert').series as Segment[]).some(s => s.data[0].row.label === protectedCategory)).toBe(false)
})

test('las barras al 100 % usan fracciones exactas aun cuando las etiquetas estén redondeadas', () => {
  const columns = ['Nunca', 'Rara vez', 'Algunas veces']
  const data = columns.map(category => ({ label: 'Grupo', category, count: 5, row_denominator: 15, percentage: 33.3 }))
  const chart = { ...scale, kind: 'matrix' as const, denominator: 15, rows: ['Grupo'], columns, data }
  const series = options(chart, 'stack').series as Segment[]
  expect(series.reduce((sum, s) => sum + s.data[0].value, 0)).toBeCloseTo(100, 10)
  expect(series.map(s => s.data[0].row.percentage)).toEqual([33.3, 33.3, 33.3])
})

test.each(['university', 'transport_mode', 'main_difficulty'])('ordena %s por frecuencia, desempata por etiqueta y deja el grupo protegido al final', key => {
  const data = [
    { label: 'Bicicleta', count: 10, percentage: 10 }, { label: protectedCategory, count: 45, percentage: 45 },
    { label: 'Otro', count: 25, percentage: 25 }, { label: 'A pie', count: 10, percentage: 10 }, { label: 'Automóvil', count: 10, percentage: 10 },
  ]
  const chart = { ...scale, key, pooled: true, data, variable_types: { [key]: 'categorical' } }
  const presented = orderChart(chart, 'bars')
  expect(presented.data.map(d => d.label)).toEqual(['Otro', 'A pie', 'Automóvil', 'Bicicleta', protectedCategory])
  expect(chart.data).toBe(data)
  const series = options(presented, 'bars').series as Segment[]
  expect(series[0].data.map(mark => [mark.row.label, mark.value, mark.row.percentage])).toEqual(presented.data.map(d => [d.label, d.count, d.percentage]))
  expect(series[0].data.at(-1)?.itemStyle.color).toBe(chartColors.pearl)
  if (key !== 'transport_mode') expect(series[0].data.slice(0, -1).map(mark => mark.itemStyle.color)).toEqual(Array(4).fill(chartColors.tomato))
})

test('conserva el orden del instrumento y los colores de una variable entre filtros', () => {
  const original = ['A pie', 'Bicicleta', 'Transporte público']
  const transport = { ...scale, key: 'transport_mode', variable_types: { transport_mode: 'categorical' },
    data: original.map((label, index) => ({ label, count: index + 6, percentage: index + 10 })) }
  const filtered = { ...transport, data: [transport.data[2], { ...transport.data[0], count: 15, percentage: 75 }] }
  const marks = (chart: ChartData) => (options(orderChart(chart, 'bars'), 'bars').series as Segment[])[0].data
  expect(marks(transport).map(d => d.row.label)).toEqual([...original].reverse())
  expect(marks(filtered).map(d => d.row.label)).toEqual([original[0], original[2]])
  for (const mark of marks(filtered)) expect(mark.itemStyle.color).toBe(marks(transport).find(d => d.row.label === mark.row.label)?.itemStyle.color)
  for (const key of ['gpa_range', 'work_hours', 'commute_time', 'motivation', 'academic_load']) {
    const ordinal = { ...scale, key, variable_types: { [key]: 'ordinal' } }
    expect(orderChart(ordinal, 'bars')).toBe(ordinal)
  }
})

test.each(['semester', 'enrollment_likelihood'])('la barra simple de %s muestra primero las respuestas más frecuentes', key => {
  const data = [
    { label: 'Primera opción', count: 8, percentage: 20 },
    { label: protectedCategory, count: 20, percentage: 50 },
    { label: 'Segunda opción', count: 12, percentage: 30 },
  ]
  const chart = { ...scale, key, pooled: true, data, variable_types: { [key]: 'ordinal' } }
  expect(orderChart(chart, 'bars').data).toEqual([data[2], data[0], data[1]])
  expect(orderChart(chart, 'stack')).toBe(chart)
})

const dropoutColors = new Map([
  ['Nunca', '#34363C'], ['Rara vez', '#81848D'], ['Algunas veces', '#C9CBD0'], ['Frecuentemente', '#F5A092'], ['Muy frecuentemente', '#F2412C'],
])

test('las barras, la dona, la leyenda y las claves de calor comparten los colores aprobados', () => {
  const data = [...dropoutColors.keys()].map(label => ({ label, count: 8, percentage: 20 }))
  const distribution = { ...scale, key: 'dropout_thoughts', data }
  const bars = (options(distribution, 'bars').series as Segment[])[0].data
  const donut = { ...distribution, key: 'dropout_composition', required_variables: ['dropout_thoughts'],
    data: [data[0], { label: 'Ha pensado en abandonar alguna vez', count: 32, percentage: 80 }] }
  const matrix: ChartData = { ...distribution, key: 'semester__dropout_thoughts', kind: 'matrix', rows: ['Grupo'], columns: [...dropoutColors.keys()],
    data: data.map(d => ({ ...d, category: d.label, label: 'Grupo', row_denominator: 40 })) }
  const heatmap = options(matrix, 'heatmap')
  const axis = heatmap.xAxis as { axisLabel: { rich: Record<string, { backgroundColor: string }> } }
  const cells = (heatmap.series as { data: { tooltip: { borderColor: string } }[] }[])[0].data
  expect(bars.map(mark => mark.itemStyle.color)).toEqual([...dropoutColors.values()])
  expect(chartLegend(matrix, 'stack').map(item => item.color)).toEqual([...dropoutColors.values()])
  expect(Object.values(axis.axisLabel.rich).map(style => style.backgroundColor)).toEqual([...dropoutColors.values()])
  expect(cells.map(cell => cell.tooltip.borderColor)).toEqual([...dropoutColors.values()])
  expect(chartLegend(donut, 'donut').map(item => item.color)).toEqual(['#34363C', chartColors.warmDark])
  expect(categoryColor('mobility_delay', 'Muy frecuentemente')).toBe(chartColors.graphite)
  expect(categoryColor('transport_mode', 'Bicicleta')).toBe(chartColors.salmon)
  expect(categoryColor('transport_mode', 'Transporte público')).toBe(chartColors.tomato)
  expect(categoryColor('motivation', '5 - Muy motivado')).toBe(chartColors.muted)
  expect(categoryColor('academic_load', '5 - Muy difícil')).toBe(chartColors.tomato)
})

test('el calor oscurece de forma continua y sus rótulos conservan contraste AA', () => {
  const channel = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  let previous = 1
  for (let percent = 0; percent <= 100; percent++) {
    const low = Math.min(Math.floor(percent / 25), 3)
    const fraction = percent / 25 - low
    const luminance = [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
      const pair = heatColors.slice(low, low + 2).map(color => parseInt(color.slice(1 + i * 2, 3 + i * 2), 16))
      return sum + weight * channel(Math.round(pair[0] + (pair[1] - pair[0]) * fraction) / 255)
    }, 0)
    const contrast = heatTextColor(percent) === chartColors.black ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05)
    expect(luminance).toBeLessThanOrEqual(previous)
    expect(contrast).toBeGreaterThanOrEqual(4.5)
    previous = luminance
  }
})

test('el orden opcional usa proporciones conjuntas publicadas y desempata por progresión', () => {
  const rows = ['Segundo o tercero', 'Cuarto o quinto', 'Sexto o séptimo', 'Octavo o superior']
  const columns = ['Frecuentemente', 'Muy frecuentemente']
  const chart: ChartData = { ...scale, key: 'semester__dropout_thoughts', kind: 'matrix', rows, columns,
    data: [[10, 10, 100], [20, 10, 100], [40, 20, 200], [30, 31, 203]].flatMap(([a, b, base], i) =>
      [a, b].map((count, j) => ({ label: rows[i], category: columns[j], count, percentage: Math.round(count * 1000 / base) / 10, row_denominator: base }))) }
  expect(canOrderByFrequent(chart)).toBe(true)
  expect(orderChart(chart, 'stack')).toBe(chart)
  const ordered = orderChart(chart, 'stack', 'frequent')
  expect(ordered.rows).toEqual([rows[3], rows[1], rows[2], rows[0]])
  expect(ordered.data.map(cell => cell.label)).toEqual(ordered.rows!.flatMap(label => [label, label]))
  for (const protectedChart of [{ ...chart, columns: ['Ha pensado en abandonar alguna vez'] }, { ...chart, data: chart.data.slice(1) }, { ...chart, status: 'insufficient' as const }]) {
    expect(canOrderByFrequent(protectedChart)).toBe(false)
    expect(orderChart(protectedChart, 'stack', 'frequent')).toBe(protectedChart)
  }
})

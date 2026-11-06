import type { ChartData } from '@/lib/api'
import { frequentDropout, protectedCategory } from './chartPalette'
import type { ChartView } from './chartOptions'

export type ChartOrder = 'default' | 'frequent'
export const orderLabels: Record<ChartOrder, string> = {
  default: 'Progresión académica',
  frequent: 'Mayor proporción de pensamientos frecuentes',
}
const alphabetical = new Intl.Collator('es', { numeric: true })
const frequencyRanked = new Set(['semester', 'enrollment_likelihood'])

function publishedRates(chart: ChartData) {
  if (chart.key !== 'semester__dropout_thoughts' || chart.status !== 'ready' || !chart.rows?.length
    || !frequentDropout.every(category => chart.columns?.includes(category))) return null
  const rates = new Map<string, { count: number; base: number }>()
  for (const label of chart.rows) {
    const [a, b] = frequentDropout.map(category => chart.data.find(cell => cell.label === label && cell.category === category))
    const base = a?.row_denominator
    if (!a || !b || !base || base !== b.row_denominator) return null
    rates.set(label, { count: a.count + b.count, base })
  }
  return rates
}

export function canOrderByFrequent(chart: ChartData) {
  return publishedRates(chart) !== null
}

export function orderChart(chart: ChartData, view: ChartView, order: ChartOrder = 'default'): ChartData {
  if (chart.status !== 'ready') return chart
  if (view === 'bars' && chart.kind !== 'matrix'
    && (frequencyRanked.has(chart.key) || chart.variable_types?.[chart.key] === 'categorical')) {
    const data = [...chart.data].sort((a, b) => {
      const poolOrder = Number(a.label === protectedCategory) - Number(b.label === protectedCategory)
      return poolOrder || b.count - a.count || alphabetical.compare(a.label, b.label)
    })
    return { ...chart, data }
  }
  if (view !== 'stack' || order !== 'frequent') return chart
  const rates = publishedRates(chart)
  if (!rates) return chart
  const rows = [...rates.keys()].sort((a, b) => {
    const first = rates.get(a)!
    const second = rates.get(b)!
    // Exact proportions. The sort is stable, retaining academic progression for ties.
    return second.count * first.base - first.count * second.base
  })
  return { ...chart, rows, data: rows.flatMap(label => chart.data.filter(cell => cell.label === label)) }
}

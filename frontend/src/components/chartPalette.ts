export const chartColors = {
  pearl: '#E4E6EA',
  graphite: '#2B2D33',
  tomato: '#F2412C',
  surface: '#F9FAFB',
  muted: '#5B5E67',
  charcoal: '#34363C',
  gray: '#81848D',
  silver: '#C9CBD0',
  salmon: '#F5A092',
  warmDark: '#B43223',
  black: '#000000',
  white: '#FFFFFF',
} as const

export const protectedCategory = 'Otras categorías · agrupadas por privacidad'
export const frequentDropout = ['Frecuentemente', 'Muy frecuentemente'] as const

const dropout: Record<string, string> = {
  Nunca: chartColors.charcoal,
  'Rara vez': chartColors.gray,
  'Algunas veces': chartColors.silver,
  [frequentDropout[0]]: chartColors.salmon,
  [frequentDropout[1]]: chartColors.tomato,
  'Ha pensado en abandonar alguna vez': chartColors.warmDark,
}
const transport: Record<string, string> = {
  'A pie': chartColors.muted,
  Bicicleta: chartColors.salmon,
  'Transporte público': chartColors.tomato,
  Motocicleta: chartColors.silver,
  Automóvil: chartColors.graphite,
  'Otros medios': chartColors.warmDark,
}
const scales: Record<string, 'difficulty' | 'support'> = {
  economic_difficulty: 'difficulty',
  academic_load: 'difficulty',
  motivation: 'support',
  institutional_support: 'support',
}
const difficulty = [chartColors.muted, chartColors.gray, chartColors.pearl, chartColors.salmon, chartColors.tomato]

export const scaleLevel = (label: string) => Number(/^([1-5]) - /.exec(label)?.[1])
export const hasDirectionalScale = (variable: string) => Boolean(scales[variable])
export const hasCategoryColors = (variable: string) => variable === 'dropout_thoughts' || variable === 'transport_mode' || hasDirectionalScale(variable)

export function categoryColor(variable: string, label: string, fallback: string = chartColors.graphite): string {
  if (label === protectedCategory) return chartColors.pearl
  if (variable === 'dropout_thoughts') return dropout[label] ?? chartColors.graphite
  if (variable === 'transport_mode') return transport[label] ?? chartColors.graphite
  const level = scaleLevel(label)
  if (scales[variable]) return level ? difficulty[scales[variable] === 'difficulty' ? level - 1 : 5 - level] : chartColors.graphite
  return fallback
}

export const heatColors = ['#FFF3F0', chartColors.salmon, chartColors.tomato, chartColors.warmDark, '#68231C']
const heatRgb = heatColors.map(color => [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16)))

export function heatTextColor(percentage: number) {
  const position = Math.max(0, Math.min(100, percentage)) / 25
  const lower = Math.min(Math.floor(position), heatRgb.length - 2)
  const fraction = position - lower
  const linear = heatRgb[lower].map((start, i) => {
    const value = Math.round(start + (heatRgb[lower + 1][i] - start) * fraction) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  return luminance >= 0.179 ? chartColors.black : chartColors.white
}

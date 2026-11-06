import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import Observatory, { AnalyticsModule, ChartPanel, Methodology } from '@/pages/Observatory'
import type { AnalyticsData, ChartData } from '@/lib/api'

vi.mock('@/components/DistributionChart', () => ({ default: ({ chart }: { chart: ChartData }) => <div data-testid={`chart-${chart.key}`}>Gráfico de {chart.denominator} respuestas</div> }))
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } },
  close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open') } },
})
const chart: ChartData = { key: 'motivation__dropout_thoughts', title: 'Motivación y pensamientos de abandono', kind: 'matrix', status: 'ready', denominator: 20, missing: 0, pooled: false, message: null, rows: ['Motivación declarada'], columns: ['Nunca', 'Rara vez'], category_catalog: { dropout_thoughts: ['Nunca', 'Rara vez'] }, data: [{ label: 'Motivación declarada', category: 'Nunca', count: 10, percentage: 50, row_denominator: 20 }, { label: 'Motivación declarada', category: 'Rara vez', count: 10, percentage: 50, row_denominator: 20 }] }
const base: AnalyticsData = { status: 'ready', data_mode: 'real', minimum_group_size: 5, eligible_responses: 20, universities: 2, filters: { university: ['Universidad A'], semester: ['Segundo o tercero'] }, selected: { university: null, semester: null }, charts: [], method: 'Descriptivo', module: 'academic', indicators: [], quality: [], versions: [{ version: 'forms-v1', active: true, options_complete: false }] }
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => Response.json(base))))
function mount(module: string) { return render(<MemoryRouter><AnalyticsModule module={module} /></MemoryRouter>) }

test.each(['academic', 'permanence', 'institutional', 'quality', 'methodology'])('el módulo %s consulta su contrato del backend', async module => {
  mount(module)
  await screen.findByText('20')
  expect(fetch).toHaveBeenCalledWith(`/api/analytics/${module}?`, expect.objectContaining({ credentials: 'same-origin' }))
  expect(screen.queryByText('Disponible en la siguiente fase')).not.toBeInTheDocument()
})

test('la tarjeta deja la tabla, el catálogo y el criterio de cálculo en la ampliación', async () => {
  render(<ChartPanel chart={chart} />)
  await screen.findByTestId(`chart-${chart.key}`)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByText('Ver categorías del cuestionario')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Ampliar gráfico/ }))
  const detail = within(screen.getByRole('dialog'))
  expect(detail.getByRole('table')).toHaveTextContent('Base del grupo')
  expect(detail.getAllByRole('cell', { name: '10' })).toHaveLength(2)
  expect(detail.getAllByRole('cell', { name: '20' })).toHaveLength(2)
  expect(detail.getByText('Ver categorías del cuestionario')).toBeVisible()
  fireEvent.click(detail.getByText('Pregunta y criterio de cálculo'))
  expect(detail.getByText(/Cada porcentaje usa las respuestas conjuntas/)).toBeVisible()
})

test.each(['insufficient', 'unavailable'] as const)('gráfico %s conserva explicación sin datos', status => {
  render(<ChartPanel chart={{ ...chart, status, data: [], denominator: null, message: 'Explicación del servidor' }} />)
  expect(screen.getByText('Explicación del servidor')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Ver detalle/ }))
  expect(within(screen.getByRole('dialog')).getByText('Explicación del servidor')).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByTestId(`chart-${chart.key}`)).not.toBeInTheDocument()
})

test('estado vacío conserva metodología y alcance del estudio', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...base, status: 'empty', eligible_responses: 0, message: 'Sin respuestas' })))
  render(<MemoryRouter><Methodology /></MemoryRouter>)
  await screen.findByText('Aún no hay resultados')
  expect(screen.getByText('Límites e interpretación')).toBeVisible()
})

test('movilidad ausente tiene una explicación y no renderiza gráficos', async () => {
  mount('academic')
  fireEvent.click(await screen.findByRole('button', { name: 'Movilidad estudiantil' }))
  expect(screen.getByText('Todavía no se han recopilado datos de movilidad en este entorno.')).toBeVisible()
  expect(screen.queryByTestId('chart-transport_mode')).not.toBeInTheDocument()
})

test('error recuperable y filtro inválido se pueden restablecer', async () => {
  let fail = true
  vi.stubGlobal('fetch', vi.fn(async () => fail ? Response.json({ detail: 'Filtro protegido' }, { status: 422 }) : Response.json(base)))
  render(<MemoryRouter initialEntries={['/?universidad=protegida']}><AnalyticsModule module="academic" /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Filtro protegido')
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
  await screen.findByText('20')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(fetch).toHaveBeenLastCalledWith('/api/analytics/academic?', expect.anything())
})

test('filtros globales persisten al navegar y se limpian juntos', async () => {
  render(<MemoryRouter initialEntries={['/observatorio?universidad=Universidad+A&semestre=Segundo+o+tercero']}><Routes><Route path="/observatorio" element={<Observatory />}><Route index element={<AnalyticsModule module="overview" />} /><Route path="academico" element={<AnalyticsModule module="academic" />} /></Route></Routes></MemoryRouter>)
  await screen.findByText('20')
  expect(screen.getByRole('link', { name: 'Exploración académica' })).toHaveAttribute('href', '/observatorio/academico?universidad=Universidad+A&semestre=Segundo+o+tercero')
  fireEvent.click(screen.getByRole('link', { name: 'Exploración académica' }))
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/analytics/academic?university=Universidad+A&semester=Segundo+o+tercero', expect.anything()))
  await screen.findByText('20')
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/analytics/academic?', expect.anything()))
})

test('selector permite consultar todos los factores sin inventar gráficos', async () => {
  const another = { ...chart, key: 'semester__dropout_thoughts', title: 'Semestre y pensamientos de abandono' }
  const economy = { ...chart, key: 'economic_difficulty__dropout_thoughts', title: 'Dificultad económica y pensamientos de abandono' }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...base, charts: [chart, economy, another] })))
  mount('academic')
  const selector = await screen.findByLabelText('Condición para comparar con pensamientos de abandono')
  fireEvent.change(selector, { target: { value: economy.key } })
  await screen.findByTestId(`chart-${economy.key}`)
  expect(screen.queryByTestId(`chart-${chart.key}`)).not.toBeInTheDocument()
  expect(screen.getByTestId(`chart-${another.key}`)).toBeInTheDocument()
})

test('actualizar vuelve a consultar los conteos vigentes', async () => {
  let count = 20
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...base, eligible_responses: count })))
  mount('quality'); await screen.findByText('20')
  count = 25
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar resultados' }))
  await screen.findByText('25')
})

test('las nuevas respuestas aparecen automáticamente cada minuto en una pestaña visible', async () => {
  let count = 20
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...base, eligible_responses: count })))
  vi.useFakeTimers()
  try {
    let view: ReturnType<typeof render> | undefined
    await act(async () => { view = mount('academic') })
    expect(screen.getByText('20')).toBeVisible()
    count = 25
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(screen.getByText('25')).toBeVisible()
    expect(fetch).toHaveBeenLastCalledWith('/api/analytics/academic?', expect.objectContaining({ cache: 'no-store' }))
    view?.unmount()
  } finally { vi.useRealTimers() }
})

test('la actualización distingue una caída de red y un error del servidor de los datos protegidos', async () => {
  const fetchResults = vi.fn()
    .mockResolvedValueOnce(Response.json({ ...base, charts: [{ ...chart, status: 'insufficient', data: [], message: 'Reserva de privacidad' }] }))
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(Response.json({ detail: 'Servicio temporalmente no disponible' }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ...base, eligible_responses: 21 }))
  vi.stubGlobal('fetch', fetchResults)
  mount('academic')
  expect(await screen.findByText('Datos protegidos')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar resultados' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Error de conexión')
  expect(screen.queryByText('Datos protegidos')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Error de consulta')
  fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }))
  expect(await screen.findByText('21')).toBeVisible()
})

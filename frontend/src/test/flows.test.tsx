import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import Consent from '@/pages/Consent'
import Survey, { QuestionField } from '@/pages/Survey'
import Thanks from '@/pages/Thanks'
import Welcome from '@/pages/Welcome'
import { Overview } from '@/pages/Observatory'

const questionnaire = { version: 'test-v1', options_basis: 'observed_in_export', title: 'Instrumento de prueba', questions: [
  { key: 'consent', prompt: '¿Aceptas participar?', section: 'Elegibilidad', kind: 'category', required: true, options: [{ value: 'Sí, acepto', label: 'Sí, acepto' }] },
  { key: 'eligibility', prompt: '¿Actualmente estás matriculado?', section: 'Elegibilidad', kind: 'category', required: true, options: [{ value: 'Sí', label: 'Sí' }, { value: 'No', label: 'No' }] },
  { key: 'motivation', prompt: 'Motivación', section: 'Experiencia', kind: 'category', required: true, options: [{ value: 'Alta', label: 'Alta' }] }
] }
let saved = false
let accepted = true
let failSubmit = false
let submitted = 0
beforeEach(() => {
  saved = false; accepted = true; failSubmit = false; submitted = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/questionnaire') return Response.json(questionnaire)
    if (url === '/api/participation/completed') return Response.json({ completed: saved })
    if (url === '/api/participation/status') return accepted ? Response.json({ accepted: true, questionnaire_version: 'test-v1', saved }) : Response.json({ detail: 'Consentimiento requerido' }, { status: 403 })
    if (url === '/api/participation/start') { accepted = JSON.parse(init!.body as string).accepted; return Response.json({ accepted }) }
    if (url === '/api/responses') { submitted++; if (failSubmit) return Response.json({ detail: 'No se guardó' }, { status: 503 }); saved = true; return Response.json({ saved: true }) }
    return Response.json({})
  }))
})
function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/" element={<Welcome />} /><Route path="/consentimiento" element={<Consent />} /><Route path="/encuesta" element={<Survey />} /><Route path="/gracias" element={<Thanks />} /><Route path="/observatorio" element={<Overview />} /></Routes></MemoryRouter>)
}
test('inicio: conserva los recorridos originales y enlaza a SAVRA Break', async () => {
  mount('/')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Entender para')
  expect(await screen.findByRole('link', { name: 'Responder encuesta' })).toHaveAttribute('href', '/consentimiento')
  expect(screen.getByRole('link', { name: 'Explorar resultados' })).toHaveAttribute('href', '/observatorio')
  expect(screen.getByRole('link', { name: 'SAVRA Break' })).toHaveAttribute('href', '/break')
  expect(screen.getByRole('button', { name: 'Compartir SAVRA' })).toBeVisible()
})
test('rechazar consentimiento regresa a inicio sin enviar una respuesta', async () => {
  mount('/consentimiento')
  await screen.findByRole('heading', { name: 'Consentimiento informado' })
  expect(screen.getByRole('link', { name: 'Elegir minijuego' })).toHaveAttribute('href', '/break')
  expect(screen.getByRole('link', { name: 'Ir a los gráficos' })).toHaveAttribute('href', '/observatorio')
  fireEvent.click(await screen.findByRole('button', { name: 'No acepto' }))
  await screen.findByRole('heading', { name: 'Soy estudiante' })
  expect(submitted).toBe(0); expect(accepted).toBe(false)
})
test.each(['/consentimiento', '/encuesta'])('una participación previa bloquea %s y ofrece resultados, 2048 e inicio', async path => {
  saved = true; mount(path)
  await screen.findByText('Desde este navegador ya se registró una participación. Gracias por contribuir a SAVRA.')
  expect(screen.getByRole('link', { name: 'Explorar resultados' })).toHaveAttribute('href', '/observatorio')
  expect(screen.getByRole('link', { name: 'Jugar SAVRA 2048' })).toHaveAttribute('href', '/break?juego=2048')
  expect(screen.getAllByRole('link', { name: 'Volver al inicio' }).every(link => link.getAttribute('href') === '/')).toBe(true)
  expect(screen.getByText(/otro perfil del navegador/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Aceptar y comenzar' })).not.toBeInTheDocument()
  expect(submitted).toBe(0)
})
test('la bienvenida reconoce la participación al regresar a la pestaña', async () => {
  mount('/')
  await screen.findByRole('link', { name: 'Responder encuesta' })
  saved = true
  fireEvent(window, new Event('focus'))
  await screen.findByRole('link', { name: 'Participación completada' })
  expect(screen.queryByRole('link', { name: 'Responder encuesta' })).not.toBeInTheDocument()
})
test('la encuesta redirige al consentimiento sin sesión aceptada', async () => {
  accepted = false; mount('/encuesta')
  await screen.findByRole('heading', { name: 'Consentimiento informado' })
  expect(submitted).toBe(0)
})
test('una persona no elegible no envía respuestas', async () => {
  mount('/encuesta')
  fireEvent.change(await screen.findByLabelText('¿Actualmente estás matriculado?'), { target: { value: 'No' } })
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  await screen.findByRole('heading', { name: 'Gracias por tu interés' }); expect(submitted).toBe(0)
})
test('no permite avanzar si falta una respuesta obligatoria', async () => {
  mount('/encuesta'); await screen.findByLabelText('¿Actualmente estás matriculado?')
  fireEvent.submit(screen.getByRole('button', { name: 'Siguiente' }).closest('form')!)
  expect(await screen.findByRole('alert')).toHaveTextContent('Completa todas')
  expect(submitted).toBe(0)
})

test('cancelar descarta la sesión y al volver exige consentimiento sin enviar datos', async () => {
  mount('/encuesta')
  fireEvent.change(await screen.findByLabelText('¿Actualmente estás matriculado?'), { target: { value: 'Sí' } })
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  await screen.findByLabelText('Motivación')
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar encuesta' }))
  await screen.findByRole('link', { name: 'Responder encuesta' })
  expect(accepted).toBe(false); expect(submitted).toBe(0)
  fireEvent.click(screen.getByRole('link', { name: 'Responder encuesta' }))
  await screen.findByRole('heading', { name: 'Consentimiento informado' })
  fireEvent.click(screen.getByRole('button', { name: 'Aceptar y comenzar' }))
  expect(await screen.findByLabelText('¿Actualmente estás matriculado?')).toHaveValue('')
  expect(submitted).toBe(0)
})

test('regresar al inicio descarta respuestas del componente sin enviar datos', async () => {
  mount('/encuesta')
  fireEvent.change(await screen.findByLabelText('¿Actualmente estás matriculado?'), { target: { value: 'Sí' } })
  fireEvent.click(screen.getByRole('link', { name: 'Volver al inicio' }))
  fireEvent.click(await screen.findByRole('link', { name: 'Responder encuesta' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Aceptar y comenzar' }))
  expect(await screen.findByLabelText('¿Actualmente estás matriculado?')).toHaveValue('')
  expect(submitted).toBe(0)
})

test('áreas: ejemplos legibles y selección inclusiva sin convertirlos en el valor', () => {
  const onChange = vi.fn()
  render(<QuestionField question={{ key: 'career_area', prompt: 'Área de tu carrera', kind: 'category', section: 'Perfil', required: true,
    options: [{ value: 'Ciencias naturales, matemáticas y estadística', label: 'Ciencias naturales, matemáticas y estadística', example: 'Biología y química.' },
      { value: 'Otra área / No encuentro mi carrera', label: 'Otra área / No encuentro mi carrera', example: 'Otras carreras.' }] }} value="" onChange={onChange} />)
  expect(screen.getByRole('group', { name: 'Área de tu carrera' })).toBeVisible()
  expect(screen.getByText('Biología y química.')).toBeVisible()
  fireEvent.click(screen.getByRole('radio', { name: /Otra área/ }))
  expect(onChange).toHaveBeenCalledWith('Otra área / No encuentro mi carrera')
})
test('solo muestra agradecimiento tras confirmación del servidor y conserva el formulario tras error', async () => {
  failSubmit = true; mount('/encuesta')
  fireEvent.change(await screen.findByLabelText('¿Actualmente estás matriculado?'), { target: { value: 'Sí' } })
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  fireEvent.change(await screen.findByLabelText('Motivación'), { target: { value: 'Alta' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó')
  expect(screen.queryByText('Gracias por')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Elegir minijuego' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Compartir SAVRA' })).not.toBeInTheDocument()
  failSubmit = false
  fireEvent.click(screen.getByRole('button', { name: 'Enviar respuestas' }))
  await screen.findByText('Respuesta guardada')
  expect(screen.getByRole('button', { name: 'Compartir SAVRA' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Elegir minijuego' })).toHaveAttribute('href', '/break')
  expect(screen.getByRole('link', { name: 'Explorar resultados' })).toHaveAttribute('href', '/observatorio')
  expect(submitted).toBe(2)
})
test('acceso directo a gracias no produce confirmación falsa', async () => {
  mount('/gracias'); await screen.findByLabelText('¿Actualmente estás matriculado?')
  expect(screen.queryByText('Respuesta guardada')).not.toBeInTheDocument()
})
test('el filtro solicita al servidor un nuevo conjunto y muestra la base actualizada', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json({ status: 'ready', data_mode: 'real', minimum_group_size: 5, eligible_responses: url.includes('university=') ? 10 : 30, universities: 1, filters: { university: ['Universidad A'], semester: [] }, charts: [], method: 'Descriptivo' })))
  mount('/observatorio'); await screen.findByText('30')
  fireEvent.change(screen.getByLabelText('Universidad'), { target: { value: 'Universidad A' } })
  await screen.findByText('10')
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/overview?university=Universidad+A', expect.anything()))
})

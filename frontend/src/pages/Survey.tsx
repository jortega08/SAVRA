import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { EmptyState, ErrorState, Loading, PublicHeader } from '@/components/shared'
import { api, ApiError, post, type Participation, type Question, type Questionnaire } from '@/lib/api'

export function QuestionField({ question, value, onChange }: { question: Question; value: string; onChange: (value: string) => void }) {
  return <div className="question-field"><label htmlFor={question.key}>{question.prompt}{!question.required && <span className="optional">Opcional</span>}</label>
    {question.kind === 'text' ? <><textarea id={question.key} value={value} onChange={e => onChange(e.target.value)} maxLength={2000} rows={4} placeholder="Evita incluir nombres, correos o información que te identifique." /><small>{value.length}/2000 caracteres</small></> :
      <select id={question.key} required={question.required} value={value} onChange={e => onChange(e.target.value)}><option value="">Selecciona una opción</option>{question.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
  </div>
}

export default function Survey() {
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ineligible, setIneligible] = useState(false)
  const sending = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const navigate = useNavigate()
  function load() {
    setError('')
    Promise.all([api<Questionnaire>('/questionnaire'), api<Participation>('/participation/status')])
      .then(([q, status]) => {
        if (status.saved) { navigate('/gracias', { replace: true }); return }
        if (!status.accepted || q.version !== status.questionnaire_version) { navigate('/consentimiento', { replace: true }); return }
        setQuestionnaire(q)
      }).catch(e => e instanceof ApiError && e.status === 403 ? navigate('/consentimiento', { replace: true }) : setError(e.message))
  }
  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    window.addEventListener('pageshow', load)
    return () => { window.removeEventListener('focus', load); window.removeEventListener('pageshow', load) }
  }, [])
  useEffect(() => { heading.current?.focus() }, [step])
  if (!questionnaire) return <><PublicHeader /><main className="survey-page">{error ? <ErrorState message={error} retry={load} /> : <Loading />}</main></>
  const sections = [...new Set(questionnaire.questions.filter(q => q.key !== 'consent').map(q => q.section))]
  const section = sections[step]
  const questions = questionnaire.questions.filter(q => q.key !== 'consent' && q.section === section)
  const last = step === sections.length - 1
  async function next(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (questions.some(q => q.required && !answers[q.key]?.trim())) { setError('Completa todas las preguntas obligatorias.'); return }
    if (step === 0 && answers.eligibility === 'No') { setIneligible(true); return }
    if (!last) { setStep(step + 1); return }
    if (sending.current) return
    sending.current = true; setBusy(true)
    try {
      const result = await post<{ saved: boolean }>('/responses', { questionnaire_version: questionnaire!.version, answers })
      if (result.saved !== true) throw new Error('La API no confirmó el almacenamiento. Puedes volver a intentar el envío.')
      navigate('/gracias', { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) navigate('/consentimiento', { replace: true })
      else if (e instanceof ApiError && e.status === 409) {
        try {
          const status = await api<Participation>('/participation/status')
          if (status.saved) { navigate('/gracias', { replace: true }); return }
        } catch { /* Keep the form available when verification also fails. */ }
        setError(e.message)
      }
      else setError((e as Error).message)
    } finally { sending.current = false; setBusy(false) }
  }
  return <><PublicHeader /><main className="survey-page">
    {ineligible ? <EmptyState title="Gracias por tu interés"><p>Esta encuesta está dirigida a personas matriculadas actualmente en una carrera universitaria en Colombia. No se ha registrado una respuesta.</p><Button asChild variant="outline"><Link to="/">Volver al inicio</Link></Button></EmptyState> : <>
      <div className="survey-progress"><span>Paso {step + 1} de {sections.length}</span><Progress value={(step + 1) * 100 / sections.length} /></div>
      <h1 ref={heading} tabIndex={-1}>{section}<span>.</span></h1><p className="page-intro">Comparte tu experiencia. Las preguntas cerradas son obligatorias.</p>
      {questionnaire.options_basis === 'observed_in_export' && <p className="instrument-note">Este formulario conserva la redacción y las opciones observadas en la exportación de Microsoft Forms. El catálogo completo de opciones originales está pendiente de validación.</p>}
      <form className="survey-form" onSubmit={next}>
        <div className="question-grid">{questions.map(q => <QuestionField key={q.key} question={q} value={answers[q.key] ?? ''} onChange={value => setAnswers(current => ({ ...current, [q.key]: value }))} />)}</div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <footer className="survey-footer"><p><LockKeyhole size={18} />Tus respuestas solo se mostrarán de forma agregada.</p><div className="form-actions">{step > 0 && <Button variant="outline" type="button" disabled={busy} onClick={() => { setStep(step - 1); setError('') }}><ArrowLeft />Anterior</Button>}<Button type="submit" disabled={busy}>{busy ? 'Guardando…' : last ? 'Enviar respuestas' : 'Siguiente'}<ArrowRight /></Button></div></footer>
      </form>
    </>}
  </main></>
}

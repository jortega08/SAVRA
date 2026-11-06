import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState, Loading, PublicHeader } from '@/components/shared'
import { api, ApiError, post, type Questionnaire } from '@/lib/api'
import { SHARED_BROWSER_NOTICE, useCompletedParticipation } from '@/lib/participation'

export default function Consent() {
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const participation = useCompletedParticipation()
  function load() { setError(''); api<Questionnaire>('/questionnaire').then(setQuestionnaire).catch(e => setError(e.message)) }
  useEffect(load, [])
  async function decide(accepted: boolean) {
    if (!questionnaire) return
    setBusy(true); setError('')
    try {
      await post('/participation/start', { accepted, questionnaire_version: questionnaire.version })
      navigate(accepted ? '/encuesta' : '/')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await participation.check()
      setError((e as Error).message)
    } finally { setBusy(false) }
  }
  if (participation.completed) return <Navigate to="/gracias" replace />
  if (participation.error || participation.completed === undefined) return <><PublicHeader /><main className="consent-page">{participation.error ? <ErrorState message={participation.error} retry={participation.check} /> : <Loading />}</main></>
  return <><PublicHeader /><main className="consent-page">
    <p className="eyebrow">Antes de comenzar</p><h1>Tu participación.<br /><span>Tu decisión.</span></h1>
    <nav className="participation-alternatives" aria-label="Opciones sin responder la encuesta">
      <Button variant="outline" asChild><Link to="/break">Elegir minijuego</Link></Button>
      <Button variant="outline" asChild><Link to="/observatorio">Ir a los gráficos</Link></Button>
    </nav>
    {!questionnaire ? error ? <ErrorState message={error} retry={load} /> : <Loading /> : <section className="consent-panel" aria-labelledby="consent-title">
      <div className="section-icon"><ShieldCheck size={26} /></div><h2 id="consent-title">Consentimiento informado</h2>
      <p>Esta encuesta tiene un propósito académico: comprender factores asociados con la intención de abandono universitario a partir de experiencias declaradas.</p>
      <dl className="consent-details">
        <div><dt>Participación voluntaria</dt><dd>Puedes no participar o salir antes del envío, sin consecuencias académicas. Solo se registran encuestas completas de personas que aceptan y están matriculadas en una carrera universitaria en Colombia.</dd></div>
        <div><dt>Tratamiento de las respuestas</dt><dd>Las respuestas se almacenan para el análisis académico de SAVRA. El formulario no solicita nombre ni correo. Evita incluir datos que te identifiquen en el campo abierto opcional.</dd></div>
        <div><dt>Cookies técnicas</dt><dd>Al aceptar se crea una sesión de consentimiento de dos horas. Solo después de guardar una participación válida se establece una cookie propia, HttpOnly, durante 180 días para reducir participaciones repetidas desde este navegador. Contiene un token aleatorio; PostgreSQL conserva únicamente su huella verificable. No se utiliza para publicidad ni seguimiento entre sitios. Borrar las cookies, usar otro navegador o dejar que caduquen elimina este reconocimiento.</dd></div>
        <div><dt>Equipos compartidos</dt><dd>{SHARED_BROWSER_NOTICE}</dd></div>
        <div><dt>Resultados agregados</dt><dd>El observatorio público muestra estadísticas, nunca respuestas individuales ni textos abiertos. Los grupos pequeños se agrupan o se omiten.</dd></div>
        <div><dt>Limitaciones de privacidad</dt><dd>No es posible garantizar anonimato absoluto: combinaciones poco frecuentes o el texto libre podrían identificarte. El alojamiento y la conexión también pueden tratar datos técnicos. Una vez enviada la encuesta, no dispondremos de una identidad para localizarla a tu nombre.</dd></div>
      </dl>
      <p className="consent-question">{questionnaire.questions.find(q => q.key === 'consent')?.prompt}</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions"><Button variant="outline" disabled={busy} onClick={() => decide(false)}>No acepto</Button><Button disabled={busy} onClick={() => decide(true)}>{busy ? 'Procesando…' : 'Aceptar y comenzar'}<ArrowRight /></Button></div>
    </section>}
  </main></>
}

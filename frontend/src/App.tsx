import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation, useMatch } from 'react-router-dom'
import { api, SIMULATION_NOTICE } from '@/lib/api'
import { EmptyState, ErrorState, Loading } from '@/components/shared'
import Welcome from '@/pages/Welcome'
const Consent = lazy(() => import('@/pages/Consent'))
const Survey = lazy(() => import('@/pages/Survey'))
const Thanks = lazy(() => import('@/pages/Thanks'))
const Break = lazy(() => import('@/pages/Break'))
import Observatory, { AnalyticsModule, Methodology, Overview } from '@/pages/Observatory'

export default function App() {
  return <><a className="skip-link" href="#app-content">Saltar al contenido</a>
    <Routes>
      <Route path="/break" element={<div id="app-content"><Suspense fallback={<Loading />}><Break /></Suspense></div>} />
      <Route path="*" element={<DataApp />} />
    </Routes>
  </>
}

function DataApp() {
  const [mode, setMode] = useState<'real' | 'demo'>()
  const [error, setError] = useState('')
  const location = useLocation()
  const isObservatory = useMatch('/observatorio/*') !== null
  function loadMode() { setError(''); api<{ data_mode: 'real' | 'demo' }>('/meta').then(m => setMode(m.data_mode)).catch(e => setError(e.message)) }
  useEffect(loadMode, [])
  useEffect(() => {
    window.scrollTo(0, 0)
    document.title = mode === 'demo' ? 'SAVRA · Demostración técnica' : 'SAVRA · ' + (isObservatory ? 'Centro de observación' : 'Entender para transformar')
  }, [location.pathname, mode, isObservatory])
  if (!mode) return error ? <ErrorState message={error} retry={loadMode} /> : <Loading text="Conectando con SAVRA…" />
  const demo = mode === 'demo'
  const demoParticipation = <main><EmptyState title="Demostración técnica"><p>Este entorno usa registros sintéticos generados por SAVRA.</p><Link to="/observatorio">Explorar la simulación</Link></EmptyState></main>
  return <>
    {(demo || !isObservatory) && <div className={demo ? 'environment-bar demo-banner' : 'environment-bar'}>
      <span role={demo ? 'status' : undefined}>{demo ? SIMULATION_NOTICE : 'Datos reales'}</span>
    </div>}
    <div id="app-content"><Suspense fallback={<Loading />}><Routes>
    <Route path="/" element={<Welcome demo={demo} />} /><Route path="/consentimiento" element={demo ? demoParticipation : <Consent />} /><Route path="/encuesta" element={demo ? demoParticipation : <Survey />} /><Route path="/gracias" element={demo ? demoParticipation : <Thanks />} />
    <Route path="/observatorio" element={<Observatory />}><Route index element={<Overview />} />{Object.entries({ academico: 'academic', permanencia: 'permanence', institucional: 'institutional', datos: 'quality' }).map(([path, module]) => <Route key={path} path={path} element={<AnalyticsModule module={module} />} />)}<Route path="metodologia" element={<Methodology />} /></Route>
    <Route path="*" element={<EmptyState title="Página no encontrada"><Link to="/">Volver al inicio</Link></EmptyState>} />
  </Routes></Suspense></div></>
}

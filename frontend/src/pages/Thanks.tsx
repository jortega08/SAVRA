import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Check } from 'lucide-react'
import { ErrorState, Loading, PublicHeader } from '@/components/shared'
import { api, ApiError, type Participation } from '@/lib/api'
import CompletedParticipation from '@/components/CompletedParticipation'

export default function Thanks() {
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  function load() {
    setError('')
    api<Participation>('/participation/status').then(status => status.saved ? setSaved(true) : navigate('/encuesta', { replace: true }))
      .catch(e => e instanceof ApiError && e.status === 403 ? navigate('/', { replace: true }) : setError(e.message))
  }
  useEffect(load, [])
  return <><PublicHeader /><main className="thanks-page">{!saved ? error ? <ErrorState message={error} retry={load} /> : <Loading text="Verificando el almacenamiento…" /> : <>
    <div className="thanks-icon"><Check size={38} /></div><p className="eyebrow">Respuesta guardada</p><h1>Gracias por<br /><span>participar.</span></h1>
    <CompletedParticipation />
    <Link className="welcome-break-link" to="/break">Elegir minijuego <ArrowUpRight aria-hidden="true" size={15} /></Link>
  </>}</main></>
}

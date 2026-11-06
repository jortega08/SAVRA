import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

export const COMPLETED_MESSAGE = 'Desde este navegador ya se registró una participación. Gracias por contribuir a SAVRA.'
export const SHARED_BROWSER_NOTICE = 'Si otra persona necesita participar en un equipo compartido, puede usar otro perfil del navegador o una ventana privada nueva y cerrarla al terminar. Esta marca reduce repeticiones accidentales; no garantiza una respuesta por persona.'

export function useCompletedParticipation(enabled = true) {
  const [completed, setCompleted] = useState<boolean>()
  const [error, setError] = useState('')
  const check = useCallback(() => {
    setError('')
    return api<{ completed: boolean }>('/participation/completed')
      .then(status => setCompleted(status.completed))
      .catch(e => setError(e.message))
  }, [])
  useEffect(() => {
    if (!enabled) return
    void check()
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    return () => { window.removeEventListener('focus', check); window.removeEventListener('pageshow', check) }
  }, [check, enabled])
  return { completed, error, check }
}

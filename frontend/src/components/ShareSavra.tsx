import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Link as LinkIcon, MessageCircle, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SAVRA_URL, SHARE_DATA, SHARE_INVITATION, WHATSAPP_URL } from '@/lib/sharing'
import './ShareSavra.css'

export default function ShareSavra() {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [status, setStatus] = useState('')
  const [manualCopy, setManualCopy] = useState('')
  const [copied, setCopied] = useState(false)
  const manualField = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (manualCopy) { manualField.current?.focus(); manualField.current?.select() }
  }, [manualCopy])

  async function share() {
    setStatus(''); setCopied(false)
    if (!navigator.share) { setOpen(true); return }
    setSharing(true)
    try {
      // Called directly from the click to preserve mobile user activation.
      await navigator.share(SHARE_DATA)
    } catch (error) {
      // Dismissing the native dialog is an ordinary action.
      if (!(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) {
        setOpen(true)
        setStatus('Puedes compartir por WhatsApp o copiar la invitación.')
      }
    } finally { setSharing(false) }
  }

  async function copy(text: string, confirmation: string) {
    setStatus(''); setCopied(false)
    try {
      await navigator.clipboard.writeText(text)
      setManualCopy(''); setCopied(true); setStatus(confirmation)
    } catch {
      setManualCopy(text)
      setStatus('Selecciona y copia el texto que aparece a continuación.')
    }
  }

  return <section className="share-savra" aria-label="Compartir SAVRA">
    <div className="share-controls">
      <Button type="button" variant="ghost" size="sm" onClick={share} disabled={sharing}>
        <Share2 aria-hidden="true" />Compartir SAVRA
      </Button>
      <button type="button" className="share-more" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(!open)}>Más opciones<ChevronDown size={14} aria-hidden="true" /></button>
    </div>
    <div id={id} hidden={!open} className="share-options" role="group" aria-label="Opciones para compartir SAVRA">
      <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} aria-hidden="true" />WhatsApp<span className="sr-only"> (abre otra aplicación o pestaña)</span></a>
      <button type="button" onClick={() => copy(SAVRA_URL, 'Enlace copiado.')}><LinkIcon size={16} aria-hidden="true" />Copiar enlace</button>
      <button type="button" onClick={() => copy(SHARE_INVITATION, 'Invitación copiada.')}><Copy size={16} aria-hidden="true" />Copiar invitación</button>
    </div>
    <p className="share-status" role="status" aria-live="polite" aria-atomic="true">{copied && <Check size={15} aria-hidden="true" />}{status}</p>
    {manualCopy && <div className="share-manual"><label htmlFor={`${id}-copy`}>Texto para copiar</label>
      <textarea id={`${id}-copy`} ref={manualField} readOnly value={manualCopy} onFocus={event => event.target.select()} rows={5} />
    </div>}
  </section>
}

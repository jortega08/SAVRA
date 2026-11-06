import { Link } from 'react-router-dom'
import { ArrowLeft, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
import { Button } from './ui/button'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" aria-label="SAVRA · Inicio" className="brand"><img src="/branding/logo_savra.png" alt="SAVRA" />{!compact && <span>Sistema de Análisis y Visualización<br />del Riesgo Académico</span>}</Link>
}
export function PublicHeader() { return <header className="public-header"><Brand /><Link className="back-link" to="/"><ArrowLeft size={16} /><span>Volver al inicio</span></Link></header> }
export function Loading({ text = 'Cargando información…' }: { text?: string }) { return <div className="state" role="status"><LoaderCircle className="animate-spin" size={25} /><p>{text}</p></div> }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <div className="state error-state" role="alert"><TriangleAlert size={26} /><h2>No pudimos cargar la información</h2><p>{message}</p>{retry && <Button variant="outline" onClick={retry}>Volver a intentar</Button>}</div> }
export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) { return <div className="state empty-state"><Info size={28} /><h2>{title}</h2><div>{children}</div></div> }

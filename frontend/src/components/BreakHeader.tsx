import { ArrowLeft, Grid2X2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand } from '@/components/shared'

export default function BreakHeader({ showGames = false }: { showGames?: boolean }) {
  return <header className="break-header">
    <Brand compact />
    <nav aria-label="Navegación de SAVRA Break">
      {showGames && <Link className="back-link" to="/break"><Grid2X2 size={15} aria-hidden="true" />Juegos</Link>}
      <Link className="back-link" to="/"><ArrowLeft size={16} aria-hidden="true" />Volver a SAVRA</Link>
    </nav>
  </header>
}

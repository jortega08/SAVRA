import { lazy, useEffect } from 'react'
import { ArrowUpRight, Crosshair } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import BreakHeader from '@/components/BreakHeader'
import './Break.css'

const Reflex = lazy(() => import('./Reflex'))
const Puzzle2048 = lazy(() => import('./Puzzle2048'))
const PREVIEW_TILES = [0, 0, 0, 0, 0, 2, 0, 4, 0, 0, 16, 32, 2, 8, 64, 128]

function BreakMenu() {
  useEffect(() => {
    document.title = 'SAVRA Break · Minijuegos'
    window.scrollTo(0, 0)
  }, [])

  return <main className="break-page">
    <BreakHeader />
    <section className="break-menu" aria-labelledby="break-menu-title">
      <p className="eyebrow">Minijuegos</p>
      <h1 id="break-menu-title">SAVRA <span>Break</span></h1>
      <p className="break-menu-lead">Una pausa para tu mente</p>
      <div className="break-game-list">
        <Link className="break-game" to="/break?juego=reflex" aria-labelledby="break-reflex-title" aria-describedby="break-reflex-summary">
          <div className="break-game-art" aria-hidden="true"><div className="break-menu-target"><Crosshair size={30} strokeWidth={1.5} /></div></div>
          <div className="break-game-info">
            <p className="eyebrow">Reflejos · 45 segundos</p>
            <h2 id="break-reflex-title">SAVRA Reflex</h2>
            <p id="break-reflex-summary">Acierta a la mira mientras el tablero se acelera.</p>
            <ArrowUpRight size={20} aria-hidden="true" />
          </div>
        </Link>
        <Link className="break-game" to="/break?juego=2048" aria-labelledby="break-puzzle-title" aria-describedby="break-puzzle-summary">
          <div className="break-game-art" aria-hidden="true">
            <div className="break-menu-tiles">{PREVIEW_TILES.map((value, index) => <span key={index} data-value={value}>{value || ''}</span>)}</div>
          </div>
          <div className="break-game-info">
            <p className="eyebrow">Lógica · A tu ritmo</p>
            <h2 id="break-puzzle-title">SAVRA 2048</h2>
            <p id="break-puzzle-summary">Desliza y combina fichas para llegar a 2048.</p>
            <ArrowUpRight size={20} aria-hidden="true" />
          </div>
        </Link>
      </div>
    </section>
  </main>
}

export default function Break() {
  const [search] = useSearchParams()
  const game = search.get('juego')
  if (game === 'reflex') return <Reflex />
  if (game === '2048') return <Puzzle2048 />
  return <BreakMenu />
}

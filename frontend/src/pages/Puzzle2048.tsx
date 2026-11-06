import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw } from 'lucide-react'
import BreakHeader from '@/components/BreakHeader'
import { Button } from '@/components/ui/button'
import { BOARD_SIZE, hasMoves, moveGame, newGame, reachedGoal, type Direction, type Game2048, type TileRoll } from '@/lib/game2048'
import './Puzzle2048.css'

const BEST_SCORE_KEY = 'savra.break.2048.best'
const SWIPE_THRESHOLD = 24
const ROWS = Array.from({ length: BOARD_SIZE }, (_, row) => row)
const CONTROLS = [
  { key: 'ArrowLeft', direction: 'left', label: 'Mover a la izquierda', Icon: ArrowLeft },
  { key: 'ArrowUp', direction: 'up', label: 'Mover arriba', Icon: ArrowUp },
  { key: 'ArrowDown', direction: 'down', label: 'Mover abajo', Icon: ArrowDown },
  { key: 'ArrowRight', direction: 'right', label: 'Mover a la derecha', Icon: ArrowRight },
] as const

type Gesture = { id: number; x: number; y: number }

function rollTile(): TileRoll {
  return [Math.random(), Math.random()]
}

function storedBest() {
  try {
    const score = Number(window.localStorage.getItem(BEST_SCORE_KEY))
    return Number.isSafeInteger(score) && score > 0 ? score : 0
  } catch {
    return 0
  }
}

function PuzzleTiles({ game }: { game: Game2048 }) {
  const survivors = new Set(game.merges.map(merge => merge.survivorId))
  const pieces = game.board.flatMap((tile, position) => tile ? [{ tile, position, absorbed: false }] : [])
  for (const merge of game.merges) pieces.push({ tile: merge.absorbed, position: merge.destination, absorbed: true })

  return <div className="puzzle-visual" aria-hidden="true">
    <div className="puzzle-slots">
      {game.board.map((_, index) => <span key={index} />)}
    </div>
    <div className="puzzle-tiles">
      {pieces.map(({ tile, position, absorbed }) => {
        const row = Math.floor(position / BOARD_SIZE)
        const column = position % BOARD_SIZE
        const effect = absorbed ? '' : survivors.has(tile.id) ? ' is-merged' : game.spawnedId === tile.id ? ' is-new' : ''
        return <div
          className={absorbed ? 'puzzle-piece is-absorbed' : 'puzzle-piece'}
          key={tile.id}
          data-position={absorbed ? undefined : position}
          style={{ transform: `translate(calc(${column} * (100% + var(--puzzle-gap))), calc(${row} * (100% + var(--puzzle-gap))))` }}
        >
          <span key={tile.value} className={'puzzle-face' + effect} data-value={tile.value} data-wide={tile.value >= 1000}>{tile.value}</span>
        </div>
      })}
    </div>
  </div>
}

export default function Puzzle2048() {
  const [{ game, best }, setSession] = useState(() => ({
    game: newGame([rollTile(), rollTile()]),
    best: storedBest(),
  }))
  const gesture = useRef<Gesture | null>(null)
  const over = !hasMoves(game.board)
  const won = reachedGoal(game.board)

  useEffect(() => {
    document.title = 'SAVRA Break · 2048'
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    try {
      if (best > storedBest()) window.localStorage.setItem(BEST_SCORE_KEY, String(best))
    } catch {
      // The game can keep the record in memory when storage is unavailable.
    }
  }, [best])

  function play(direction: Direction) {
    const roll = rollTile()
    setSession(current => {
      const next = moveGame(current.game, direction, roll)
      return next === current.game ? current : { game: next, best: Math.max(current.best, next.score) }
    })
  }

  function restart() {
    const rolls = [rollTile(), rollTile()] as const
    gesture.current = null
    setSession(current => ({ ...current, game: newGame(rolls, current.game.nextId) }))
  }

  function startGesture(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return
    event.currentTarget.focus({ preventScroll: true })
    if (event.pointerType === 'mouse') return
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function cancelGesture(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.id === event.pointerId) gesture.current = null
  }

  function finishGesture(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current
    if (!start || start.id !== event.pointerId) return
    gesture.current = null
    const x = event.clientX - start.x
    const y = event.clientY - start.y
    if (Math.max(Math.abs(x), Math.abs(y)) < SWIPE_THRESHOLD) return
    play(Math.abs(x) >= Math.abs(y) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down'))
  }

  return <main className="break-page">
    <BreakHeader showGames />

    <section className="puzzle-layout" aria-labelledby="break-title">
      <div className="puzzle-intro">
        <p className="eyebrow puzzle-kicker">Minijuego 2048</p>
        <h1 id="break-title">SAVRA <span>Break</span></h1>
        <p className="puzzle-lead">Una pausa para tu mente</p>
        <p className="puzzle-description">Combina fichas iguales para llegar a 2048.</p>
        <dl className="puzzle-scores">
          <div aria-live="polite" aria-atomic="true">
            <dt>Puntuación</dt>
            <dd data-testid="puzzle-score">{game.score}</dd>
          </div>
          <div>
            <dt>Mejor puntuación</dt>
            <dd data-testid="puzzle-best">{best}</dd>
          </div>
        </dl>
        <Button type="button" onClick={restart}><RotateCcw aria-hidden="true" />Nueva partida</Button>
        <div className="puzzle-status" role="status">
          {over ? <><strong>Fin de partida</strong><span>{won ? 'Alcanzaste 2048. Puedes iniciar otra partida.' : 'Se acabaron los movimientos. Puedes iniciar otra partida.'}</span></>
            : won && <><strong>¡Alcanzaste 2048!</strong><span>Puedes seguir jugando.</span></>}
        </div>
      </div>
      <div className="puzzle-play">
        <div
          className="puzzle-board"
          role="group"
          aria-label="Tablero de 2048"
          aria-describedby="puzzle-instructions"
          tabIndex={0}
          onKeyDown={event => {
            const control = CONTROLS.find(option => option.key === event.key)
            if (!control || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            event.preventDefault()
            if (!event.repeat) play(control.direction)
          }}
          onPointerDown={startGesture}
          onPointerUp={finishGesture}
          onPointerCancel={cancelGesture}
          onLostPointerCapture={cancelGesture}
        >
          <PuzzleTiles game={game} />
          <table className="sr-only">
            <caption>Fichas por fila y columna</caption>
            <tbody>
              {ROWS.map(row => <tr key={row}>{ROWS.map(column =>
                <td key={column}>{game.board[row * BOARD_SIZE + column]?.value ?? 'Vacío'}</td>,
              )}</tr>)}
            </tbody>
          </table>
        </div>
        <div className="puzzle-tools">
          <p id="puzzle-instructions">Desliza sobre el tablero o enfócalo y usa las flechas.</p>
          <div className="puzzle-arrows" role="group" aria-label="Controles de dirección" onKeyDown={event => {
            if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
          }}>
            {CONTROLS.map(({ direction, label, Icon }) =>
              <Button key={direction} type="button" variant="outline" size="icon" aria-label={label} disabled={over} onClick={() => play(direction)}>
                <Icon aria-hidden="true" />
              </Button>,
            )}
          </div>
        </div>
      </div>
    </section>
  </main>
}

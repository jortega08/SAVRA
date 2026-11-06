import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, Circle, Crosshair, Diamond, Plus, RotateCcw, Triangle, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import BreakHeader from '@/components/BreakHeader'
import { Button } from '@/components/ui/button'
import './Reflex.css'

const ROUND_SECONDS = 45
const LEVEL_SECONDS = 15
const GRID_SIZE = 4
const SLOTS = Array.from({ length: GRID_SIZE ** 2 }, (_, index) => index)
const LEVELS = [
  { name: 'Calentamiento', lifetime: 1800, decoys: 0 },
  { name: 'Aceleración', lifetime: 1250, decoys: 2 },
  { name: 'Contrarreloj', lifetime: 850, decoys: 5 },
]
const DECOY_ICONS = [Diamond, Triangle, Circle, X, Plus]

type Layout = {
  level: number
  target: number
  decoys: number[]
  expiresAt: number
}

type Round = {
  endsAt: number
  seconds: number
  score: number
  faults: number
  lastAttempt: 'hit' | 'fault' | null
  layout: Layout
}

function secondsLeft(endsAt: number, now: number) {
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

function levelAt(seconds: number) {
  return Math.min(LEVELS.length - 1, Math.floor((ROUND_SECONDS - seconds) / LEVEL_SECONDS))
}

function shuffleSlots() {
  const slots = [...SLOTS]
  for (let index = slots.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    const picked = slots[other]
    slots[other] = slots[index]
    slots[index] = picked
  }
  return slots
}

function makeLayout(now: number, level: number, slots: number[], previous?: number): Layout {
  const target = slots[0] === previous ? slots[1] : slots[0]
  return {
    level,
    target,
    decoys: slots.filter(slot => slot !== target).slice(0, LEVELS[level].decoys),
    expiresAt: now + LEVELS[level].lifetime,
  }
}

function nextSlot(slot: number, direction: string) {
  let row = Math.floor(slot / GRID_SIZE)
  let column = slot % GRID_SIZE
  if (direction === 'ArrowUp') row--
  if (direction === 'ArrowDown') row++
  if (direction === 'ArrowLeft') column--
  if (direction === 'ArrowRight') column++
  return Math.min(GRID_SIZE - 1, Math.max(0, row)) * GRID_SIZE + Math.min(GRID_SIZE - 1, Math.max(0, column))
}

export default function Reflex() {
  const [round, setRound] = useState<Round | null>(null)
  const [cursor, setCursor] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const board = useRef<HTMLDivElement>(null)
  const playing = round !== null && round.seconds > 0
  const endsAt = playing ? round.endsAt : null
  const layout = playing ? round.layout : null

  useEffect(() => {
    document.title = 'SAVRA Break · SAVRA Reflex'
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
    if (playing) board.current?.focus({ preventScroll: true })
    else heading.current?.focus({ preventScroll: true })
  }, [playing])

  useEffect(() => {
    if (endsAt === null || layout === null) return
    let timer: number

    const updateClock = () => {
      window.clearTimeout(timer)
      const now = performance.now()
      const seconds = secondsLeft(endsAt, now)
      const level = levelAt(seconds)
      const expired = seconds > 0 && (now >= layout.expiresAt || level !== layout.level)
      const nextLayout = expired ? makeLayout(now, level, shuffleSlots(), layout.target) : layout

      setRound(current => current?.layout === layout && (current.seconds !== seconds || expired)
        ? { ...current, seconds, layout: nextLayout }
        : current)
      if (seconds > 0 && !expired) {
        const nextSecond = endsAt - (seconds - 1) * 1000
        timer = window.setTimeout(updateClock, Math.ceil(Math.min(nextSecond, layout.expiresAt) - now))
      }
    }

    updateClock()
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [endsAt, layout])

  function startRound() {
    const now = performance.now()
    setCursor(0)
    setRound({
      endsAt: now + ROUND_SECONDS * 1000,
      seconds: ROUND_SECONDS,
      score: 0,
      faults: 0,
      lastAttempt: null,
      layout: makeLayout(now, 0, shuffleSlots()),
    })
  }

  function attempt(slot: number | null) {
    const now = performance.now()
    const slots = shuffleSlots()
    setRound(current => {
      if (!current || current.seconds === 0) return current
      const seconds = secondsLeft(current.endsAt, now)
      if (seconds === 0) return { ...current, seconds }

      const level = levelAt(seconds)
      const expired = now >= current.layout.expiresAt || level !== current.layout.level
      const hit = current.layout === layout && !expired && current.layout.target === slot
      return {
        ...current,
        seconds,
        score: current.score + Number(hit),
        faults: current.faults + Number(!hit),
        lastAttempt: hit ? 'hit' : 'fault',
        layout: hit || expired ? makeLayout(now, level, slots, current.layout.target) : current.layout,
      }
    })
  }

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      if (event.repeat || event.target === event.currentTarget) event.preventDefault()
      return
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const slot = event.target === event.currentTarget ? cursor : nextSlot(cursor, event.key)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)?.focus({ preventScroll: true })
  }

  return <main className={playing ? 'break-page is-playing' : 'break-page'}>
    <BreakHeader showGames />

    {playing ? <section className="reflex-session" aria-labelledby="reflex-title">
      <div className="reflex-hud">
        <div>
          <p className="eyebrow">SAVRA Break</p>
          <h1 id="reflex-title">SAVRA <span>Reflex</span></h1>
        </div>
        <dl className="reflex-stats">
          <div>
            <dt id="reflex-time-label">Tiempo</dt>
            <dd role="timer" aria-labelledby="reflex-time-label">00:{String(round.seconds).padStart(2, '0')}</dd>
          </div>
          <div aria-live="polite" aria-atomic="true">
            <dt>Puntos</dt>
            <dd data-testid="reflex-score">{round.score}</dd>
          </div>
          <div aria-live="polite" aria-atomic="true">
            <dt>Fallos</dt>
            <dd data-testid="reflex-faults">{round.faults}</dd>
          </div>
        </dl>
      </div>
      <div className="reflex-time-track" aria-hidden="true">
        <div style={{ transform: `scaleX(${round.seconds / ROUND_SECONDS})` }} />
      </div>
      <div className="reflex-meta">
        <p className="reflex-level"><strong>Nivel {round.layout.level + 1} de {LEVELS.length}</strong> {LEVELS[round.layout.level].name}</p>
        <p className={round.lastAttempt === 'fault' ? 'reflex-feedback is-fault' : 'reflex-feedback'} aria-hidden="true">
          {round.lastAttempt === 'fault' ? 'Toque falso' : round.lastAttempt === 'hit' ? '+1 punto' : 'Busca la mira'}
        </p>
      </div>
      <div
        ref={board}
        className="reflex-board reflex-field"
        role="group"
        aria-label="Área de juego"
        aria-describedby="reflex-controls"
        tabIndex={-1}
        style={{ gridTemplate: `repeat(${GRID_SIZE}, 1fr) / repeat(${GRID_SIZE}, 1fr)` }}
        onKeyDown={moveFocus}
        onClick={event => {
          const cell = event.target instanceof Element ? event.target.closest('[data-slot]') : null
          attempt(cell ? Number(cell.getAttribute('data-slot')) : null)
        }}
      >
        {SLOTS.map(slot => {
          const isTarget = slot === round.layout.target
          const decoyIndex = round.layout.decoys.indexOf(slot)
          const Decoy = decoyIndex === -1 ? undefined : DECOY_ICONS[decoyIndex]
          const label = isTarget ? 'Objetivo' : Decoy ? 'Distractor' : 'Vacío'
          return <button
            key={slot}
            type="button"
            className="reflex-cell"
            data-slot={slot}
            tabIndex={cursor === slot ? 0 : -1}
            aria-label={`${label}, fila ${Math.floor(slot / GRID_SIZE) + 1}, columna ${slot % GRID_SIZE + 1}`}
            onFocus={() => setCursor(slot)}
          >
            {isTarget && <span className="reflex-target-face" aria-hidden="true"><Crosshair size={27} strokeWidth={1.5} /></span>}
            {Decoy && <span className="reflex-decoy-face" aria-hidden="true"><Decoy size={24} strokeWidth={1.5} /></span>}
          </button>
        })}
        {round.lastAttempt === 'fault' && <span key={round.faults} className="reflex-fault-flash" aria-hidden="true" />}
      </div>
      <p id="reflex-controls" className="reflex-controls">Toca o haz clic en la mira. Con teclado, elige una casilla con las flechas y confírmala con <kbd>Enter</kbd>.</p>
    </section> : <section className="reflex-cover" aria-labelledby="reflex-title">
      <div className="reflex-intro">
        <p className="eyebrow reflex-kicker">SAVRA Break</p>
        <h1 id="reflex-title" tabIndex={-1} ref={heading} aria-describedby={round ? 'reflex-final-score' : undefined}>
          {round ? <>Tiempo<br /><span>cumplido.</span></> : <>SAVRA<br /><span>Reflex.</span></>}
        </h1>
        <p className="reflex-lead">{round ? 'Terminaste tu partida de SAVRA Reflex.' : 'Una pausa de 45 segundos para poner a prueba tus reflejos.'}</p>
        {!round && <p className="reflex-instructions">Toca o haz clic en la mira para sumar un punto. Cada nivel es más rápido y añade distractores. Si tocas otra figura o el fondo, cuenta como fallo.</p>}
        <div className="reflex-intro-actions">
          <Button type="button" onClick={startRound}>
            {round ? <><RotateCcw aria-hidden="true" />Volver a jugar</> : <>Empezar partida <ArrowRight aria-hidden="true" /></>}
          </Button>
          {round && <Button variant="outline" asChild><Link to="/observatorio">Ir a los gráficos</Link></Button>}
        </div>
      </div>
      <div className="reflex-board reflex-poster" aria-hidden={round ? undefined : true}>
        <span className="reflex-board-label">{round ? 'Resultado final' : 'Objetivo móvil'}</span>
        {round ? <p id="reflex-final-score" className="reflex-result">
          <strong>{round.score}</strong><span>{round.score === 1 ? 'punto' : 'puntos'}</span>
          <small>{round.faults} {round.faults === 1 ? 'toque falso' : 'toques falsos'}</small>
        </p>
          : <div className="reflex-poster-target"><span><Crosshair size={55} strokeWidth={1.1} /></span></div>}
        <span className="reflex-board-label">{ROUND_SECONDS} s</span>
      </div>
    </section>}
  </main>
}

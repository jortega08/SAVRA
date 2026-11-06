import { expect, test } from 'vitest'
import { hasMoves, moveGame, newGame, reachedGoal, type Game2048, type TileRoll } from '@/lib/game2048'

const first: TileRoll = [0, 0]
const last: TileRoll = [0.999, 0]

function game(values: number[], score = 0): Game2048 {
  return {
    board: Array.from({ length: 16 }, (_, index) => values[index] ? { id: index + 1, value: values[index] } : null),
    score,
    nextId: 17,
    spawnedId: null,
    merges: [],
  }
}

function valuesBeforeSpawn(next: Game2048) {
  return next.board.map(tile => tile && tile.id !== next.spawnedId ? tile.value : 0)
}

test('inicia con dos fichas distintas, permite generar 2 y 4 y reinicia la puntuación', () => {
  const initial = newGame([first, [0, 0.9]])
  expect(initial.board.filter(tile => tile !== null)).toEqual([{ id: 1, value: 2 }, { id: 2, value: 4 }])
  expect(initial.board).toHaveLength(16)
  expect(initial.score).toBe(0)

  const played = moveGame(initial, 'down', first)
  const restarted = newGame([first, last], played.nextId)
  expect(restarted.board.filter(tile => tile !== null)).toHaveLength(2)
  expect(restarted.board[0]?.id).toBe(played.nextId)
  expect(restarted.score).toBe(0)
})

test.each([
  ['left', 4],
  ['right', 7],
  ['up', 1],
  ['down', 13],
] as const)('desplaza hacia %s y genera una única ficha', (direction, destination) => {
  const initial = game([0, 0, 0, 0, 0, 8])
  const result = moveGame(initial, direction, [0, 0.99])
  expect(valuesBeforeSpawn(result)[destination]).toBe(8)
  expect(result.board[destination]).toBe(initial.board[5])
  expect(result.board.filter(tile => tile !== null)).toHaveLength(2)
  expect(result.board.find(tile => tile?.id === result.spawnedId)?.value).toBe(4)
  expect(result.score).toBe(0)
})

test('un movimiento inválido conserva la partida y su siguiente identificador', () => {
  const initial = game([2, 4, 8, 16])
  expect(moveGame(initial, 'left', first)).toBe(initial)
  expect(moveGame(initial, 'up', last)).toBe(initial)
})

test('fusiona dos pares independientes y suma ambas fusiones', () => {
  const initial = game([2, 2, 2, 2], 20)
  const result = moveGame(initial, 'left', last)
  expect(valuesBeforeSpawn(result).slice(0, 4)).toEqual([4, 4, 0, 0])
  expect(result.merges.map(merge => merge.destination)).toEqual([0, 1])
  expect(result.score).toBe(28)
  expect(initial.board.slice(0, 4).map(tile => tile?.value)).toEqual([2, 2, 2, 2])
})

test('las fusiones se resuelven desde el borde elegido y esperan otro movimiento para encadenarse', () => {
  const initial = game([2, 0, 2, 4])
  const left = moveGame(initial, 'left', last)
  expect(valuesBeforeSpawn(left).slice(0, 4)).toEqual([4, 4, 0, 0])
  expect(left.score).toBe(4)
  const chain = moveGame(left, 'left', last)
  expect(valuesBeforeSpawn(chain).slice(0, 4)).toEqual([8, 0, 0, 0])
  expect(chain.score).toBe(12)
  const right = moveGame(game([2, 2, 2]), 'right', last)
  expect(valuesBeforeSpawn(right).slice(0, 4)).toEqual([0, 0, 2, 4])
})

test('detecta 2048 y permite superar el objetivo', () => {
  const initial = game([1024, 1024])
  const won = moveGame(initial, 'left', last)
  expect(reachedGoal(initial.board)).toBe(false)
  expect(reachedGoal(won.board)).toBe(true)
  expect(won.score).toBe(2048)
  const continued = moveGame(won, 'down', last)
  expect(continued).not.toBe(won)
  expect(reachedGoal(continued.board)).toBe(true)
  const surpassed = moveGame(game([2048, 2048], won.score), 'left', last)
  expect(surpassed.board[0]?.value).toBe(4096)
  expect(surpassed.score).toBe(6144)
  expect(reachedGoal(surpassed.board)).toBe(true)
})

test('detecta el tablero bloqueado después de generar la última ficha', () => {
  const initial = game([
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2,
    4, 2, 4, 0,
  ])
  expect(hasMoves(initial.board)).toBe(true)
  const blocked = moveGame(initial, 'right', first)
  expect(hasMoves(blocked.board)).toBe(false)
  expect(blocked.board.every(tile => tile !== null)).toBe(true)
  expect(moveGame(blocked, 'up', first)).toBe(blocked)

  const verticalMerge = game(blocked.board.map((tile, index) => index === 0 ? 2 : tile!.value))
  expect(hasMoves(verticalMerge.board)).toBe(true)
})

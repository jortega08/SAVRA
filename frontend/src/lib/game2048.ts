export const BOARD_SIZE = 4
export const GOAL = 2048

export type Direction = 'up' | 'down' | 'left' | 'right'
export type Tile = { id: number; value: number }
export type Board = readonly (Tile | null)[]
export type TileRoll = readonly [position: number, value: number]

export type Game2048 = {
  board: Board
  score: number
  nextId: number
  spawnedId: number | null
  merges: readonly { absorbed: Tile; survivorId: number; destination: number }[]
}

const CELL_COUNT = BOARD_SIZE ** 2

function spawn(board: (Tile | null)[], id: number, [position, value]: TileRoll) {
  const empty = board.flatMap((tile, index) => tile === null ? [index] : [])
  board[empty[Math.floor(position * empty.length)]] = { id, value: value < 0.9 ? 2 : 4 }
}

export function newGame(rolls: readonly [TileRoll, TileRoll], nextId = 1): Game2048 {
  const board = Array<Tile | null>(CELL_COUNT).fill(null)
  rolls.forEach((roll, index) => spawn(board, nextId + index, roll))
  return { board, score: 0, nextId: nextId + 2, spawnedId: null, merges: [] }
}

function lineIndices(line: number, direction: Direction) {
  return Array.from({ length: BOARD_SIZE }, (_, offset) => {
    const edge = direction === 'right' || direction === 'down' ? BOARD_SIZE - 1 - offset : offset
    return direction === 'left' || direction === 'right'
      ? line * BOARD_SIZE + edge
      : edge * BOARD_SIZE + line
  })
}

export function moveGame(game: Game2048, direction: Direction, roll: TileRoll): Game2048 {
  const board = Array<Tile | null>(CELL_COUNT).fill(null)
  const merges: Game2048['merges'][number][] = []
  let score = game.score

  for (let line = 0; line < BOARD_SIZE; line++) {
    const indices = lineIndices(line, direction)
    const tiles = indices.map(index => game.board[index]).filter(tile => tile !== null)
    let destination = 0

    for (let index = 0; index < tiles.length; index++) {
      const tile = tiles[index]
      const neighbor = tiles[index + 1]
      const cell = indices[destination++]
      if (neighbor?.value === tile.value) {
        const value = tile.value * 2
        board[cell] = { id: tile.id, value }
        score += value
        merges.push({ absorbed: neighbor, survivorId: tile.id, destination: cell })
        index++
      } else {
        board[cell] = tile
      }
    }
  }

  if (board.every((tile, index) => tile === game.board[index])) return game

  spawn(board, game.nextId, roll)
  return { board, score, nextId: game.nextId + 1, spawnedId: game.nextId, merges }
}

export function reachedGoal(board: Board) {
  return board.some(tile => tile !== null && tile.value >= GOAL)
}

export function hasMoves(board: Board) {
  return board.some((tile, index) => tile === null
    || (index % BOARD_SIZE < BOARD_SIZE - 1 && tile.value === board[index + 1]?.value)
    || tile.value === board[index + BOARD_SIZE]?.value)
}

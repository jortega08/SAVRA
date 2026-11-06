import type { Locator, Page } from '@playwright/test'
import { expect, test } from './isolated'

const bestKey = 'savra.break.2048.best'

function positions(board: Locator) {
  return board.locator('[data-position]').evaluateAll(tiles =>
    tiles.map(tile => Number(tile.getAttribute('data-position'))).sort((a, b) => a - b),
  )
}

async function seed2048(page: Page) {
  // Two adjacent 2s on the top row, then a 2 in the first vacant slot.
  await page.addInitScript(() => { Math.random = () => 0.001 })
}

test('juega con flechas sin API, ignora la repetición y conserva solo el récord', async ({ page, context }) => {
  await seed2048(page)
  const apiRequests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url())
  })
  await page.route('**/api/**', route => route.abort())
  expect((await page.goto('/break'))?.status()).toBe(200)
  await expect(page.getByRole('link', { name: 'SAVRA Reflex' })).toBeVisible()
  await page.getByRole('link', { name: 'SAVRA 2048' }).click()
  await expect(page).toHaveURL(/\/break\?juego=2048$/)

  const board = page.getByRole('group', { name: 'Tablero de 2048' })
  const score = page.getByTestId('puzzle-score')
  const best = page.getByTestId('puzzle-best')
  const restart = page.getByRole('button', { name: 'Nueva partida' })
  await expect(board).toBeVisible()
  expect(await positions(board)).toEqual([0, 1])
  await page.keyboard.press('ArrowDown')
  expect(await positions(board)).toEqual([0, 1])
  await board.focus()
  await page.keyboard.press('ArrowUp')
  expect(await positions(board)).toEqual([0, 1])

  await page.keyboard.down('ArrowDown')
  await page.keyboard.down('ArrowDown')
  await page.keyboard.up('ArrowDown')
  expect(await positions(board)).toEqual([0, 12, 13])
  await expect(score).toHaveText('0')

  await restart.click()
  expect(await positions(board)).toEqual([0, 1])
  await board.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(score).toHaveText('4')
  await expect(best).toHaveText('4')
  await expect(board.locator('.is-merged')).toHaveCSS('animation-name', 'puzzle-merge')
  await expect(board.locator('.is-new')).toHaveCSS('animation-name', 'puzzle-appear')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  expect(await positions(board)).toEqual([0, 3, 14, 15])

  await page.reload()
  await expect(score).toHaveText('0')
  await expect(best).toHaveText('4')
  expect(apiRequests).toEqual([])
  expect(await context.storageState({ indexedDB: true })).toEqual({
    cookies: [],
    origins: [{ origin: new URL(page.url()).origin, localStorage: [{ name: bestKey, value: '4' }], indexedDB: [] }],
  })
})

test.describe('tablero móvil', () => {
  test.use({ hasTouch: true, isMobile: true, reducedMotion: 'reduce', viewport: { width: 320, height: 568 } })

  test('reconoce un movimiento por gesto en un tablero de 320 px y respeta el movimiento reducido', async ({ page, context }) => {
    await seed2048(page)
    await page.goto('/')
    await page.getByRole('link', { name: 'SAVRA Break', exact: true }).tap()
    await expect(page).toHaveURL(/\/break$/)
    await page.getByRole('link', { name: 'SAVRA 2048' }).tap()
    const board = page.getByRole('group', { name: 'Tablero de 2048' })
    await board.scrollIntoViewIfNeeded()
    await expect(board).toBeInViewport({ ratio: 1 })
    await expect(board).toHaveCSS('touch-action', 'pinch-zoom')
    await expect(page.locator('body')).toHaveCSS('touch-action', 'auto')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const box = (await board.boundingBox())!
    const x = Math.round(box.x + box.width / 2)
    const y = Math.round(box.y + box.height / 2)
    const initialScroll = await page.evaluate(() => window.scrollY)
    const cdp = await context.newCDPSession(page)

    async function swipe(dx: number, dy: number) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }

    await swipe(10, 0)
    expect(await positions(board)).toEqual([0, 1])
    await swipe(0, 85)
    expect(await positions(board)).toEqual([0, 12, 13])
    expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll)
    await expect(board.locator('.is-new')).toHaveCSS('animation-name', 'none')
    await expect(board.locator('[data-position]').first()).toHaveCSS('transition-duration', '0s')

    await page.getByRole('link', { name: 'Juegos', exact: true }).click()
    await expect(page.getByRole('link', { name: 'SAVRA Reflex' })).toBeVisible()
    await page.getByRole('link', { name: 'Volver a SAVRA' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('los controles alternativos responden a un toque', async ({ page }) => {
    await seed2048(page)
    await page.goto('/break?juego=2048')
    const board = page.getByRole('group', { name: 'Tablero de 2048' })
    const right = page.getByRole('button', { name: 'Mover a la derecha' })
    await right.scrollIntoViewIfNeeded()
    await right.tap()
    await expect(page.getByTestId('puzzle-score')).toHaveText('4')
    expect(await positions(board)).toEqual([0, 3])
  })
})

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('acceso sin API, tres niveles, detección de fallos y reinicio a los 45 segundos', async ({ page, context }) => {
  const apiRequests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url())
  })
  await page.route('**/api/**', route => route.abort())
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') })

  expect((await page.goto('/break?juego=reflex'))?.status()).toBe(200)
  const start = page.getByRole('button', { name: 'Empezar partida' })
  await expect(start).toBeVisible()
  await page.clock.pauseAt(new Date('2026-01-01T12:01:00Z'))
  await start.focus()
  await page.keyboard.press('Enter')

  const timer = page.getByRole('timer')
  const board = page.getByRole('group', { name: 'Área de juego' })
  const target = board.getByRole('button', { name: /^Objetivo,/ })
  const decoys = board.getByRole('button', { name: /^Distractor,/ })
  const points = page.getByTestId('reflex-score')
  const faults = page.getByTestId('reflex-faults')
  await expect(timer).toHaveText('00:45')
  await expect(points).toHaveText('0')
  await expect(decoys).toHaveCount(0)
  await expect(board).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(points).toHaveText('0')
  await expect(faults).toHaveText('0')

  await page.keyboard.press('ArrowRight')
  const firstSlot = Number(await target.getAttribute('data-slot'))
  for (let step = 0; step < firstSlot % 4; step++) await page.keyboard.press('ArrowRight')
  for (let step = 0; step < Math.floor(firstSlot / 4); step++) await page.keyboard.press('ArrowDown')
  await expect(target).toBeFocused()
  await page.keyboard.down('Enter')
  await page.keyboard.down('Enter')
  await page.keyboard.up('Enter')
  await expect(points).toHaveText('1')
  await expect(faults).toHaveText('0')
  await expect(board.locator(`[data-slot="${firstSlot}"]`)).toBeFocused()
  await expect(target).not.toBeFocused()
  await page.keyboard.press('Enter')
  await expect(points).toHaveText('1')
  await expect(faults).toHaveText('1')

  const warmupSlot = await target.getAttribute('data-slot')
  await page.clock.runFor(1000)
  await expect(timer).toHaveText('00:44')
  await page.clock.runFor(799)
  await expect(target).toHaveAttribute('data-slot', warmupSlot!)
  await page.clock.runFor(1)
  await expect(target).not.toHaveAttribute('data-slot', warmupSlot!)

  await page.clock.fastForward(13_200)
  await expect(timer).toHaveText('00:30')
  await expect(page.getByText('Nivel 2 de 3')).toBeVisible()
  await expect(decoys).toHaveCount(2)
  const decoy = await center(decoys.first())
  await page.mouse.click(decoy.x, decoy.y)
  await expect(faults).toHaveText('2')
  await expect(points).toHaveText('1')
  const middleSlot = await target.getAttribute('data-slot')
  await page.clock.runFor(1249)
  await expect(target).toHaveAttribute('data-slot', middleSlot!)
  await page.clock.runFor(1)
  await expect(target).not.toHaveAttribute('data-slot', middleSlot!)

  await page.clock.fastForward(13_750)
  await expect(timer).toHaveText('00:15')
  await expect(page.getByText('Nivel 3 de 3')).toBeVisible()
  await expect(decoys).toHaveCount(5)
  const finalSlot = await target.getAttribute('data-slot')
  await page.clock.runFor(849)
  await expect(target).toHaveAttribute('data-slot', finalSlot!)
  await page.clock.runFor(1)
  await expect(target).not.toHaveAttribute('data-slot', finalSlot!)
  const aim = await center(target)
  await page.mouse.click(aim.x, aim.y)
  await expect(points).toHaveText('2')
  await expect(faults).toHaveText('2')

  await page.clock.fastForward(14_149)
  await expect(timer).toHaveText('00:01')
  await page.clock.runFor(1)
  await expect(target).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Tiempo cumplido.' })).toBeFocused()
  await expect(page.locator('#reflex-final-score')).toHaveText(/2\s*puntos\s*2 toques falsos/)
  await expect(page.getByRole('link', { name: 'Ir a los gráficos' })).toHaveAttribute('href', '/observatorio')

  await page.getByRole('button', { name: 'Volver a jugar' }).focus()
  await page.keyboard.press('Enter')
  await expect(timer).toHaveText('00:45')
  await expect(points).toHaveText('0')
  await expect(faults).toHaveText('0')
  await expect(decoys).toHaveCount(0)
  await page.clock.fastForward(45_000)
  await expect(page.locator('#reflex-final-score')).toHaveText(/0\s*puntos/)
  expect(apiRequests).toEqual([])
  expect(await context.storageState({ indexedDB: true })).toEqual({ cookies: [], origins: [] })
})

test.describe('Reflex táctil', () => {
  test.use({ isMobile: true, hasTouch: true, reducedMotion: 'reduce' })

  test('desde bienvenida, con objetivos visibles en vertical y horizontal', async ({ page }) => {
    const mutations: string[] = []
    page.on('request', request => {
      if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.url())
    })
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto('/')
    await page.getByRole('link', { name: 'SAVRA Break', exact: true }).tap()
    await expect(page).toHaveURL(/\/break$/)
    await page.getByRole('link', { name: 'SAVRA Reflex' }).tap()
    const start = page.getByRole('button', { name: 'Empezar partida' })
    await start.tap()
    const board = page.getByRole('group', { name: 'Área de juego' })
    const target = board.getByRole('button', { name: /^Objetivo,/ })
    const points = page.getByTestId('reflex-score')
    const faults = page.getByTestId('reflex-faults')
    await expect(target.locator('span')).toHaveCSS('animation-name', 'none')
    await expect(board).toHaveCSS('touch-action', 'pinch-zoom')

    let score = 0
    for (const viewport of [{ width: 320, height: 568 }, { width: 780, height: 360 }]) {
      await page.setViewportSize(viewport)
      for (let tap = 0; tap < 5; tap++) {
        await expect(target).toBeInViewport({ ratio: 1 })
        const position = (await target.boundingBox())!
        expect(position.width).toBeGreaterThanOrEqual(48)
        expect(position.height).toBeGreaterThanOrEqual(48)
        await page.touchscreen.tap(position.x + position.width / 2, position.y + position.height / 2)
        await expect(points).toHaveText(String(++score))
        expect(await target.boundingBox()).not.toEqual(position)
        await page.touchscreen.tap(position.x + position.width / 2, position.y + position.height / 2)
        await expect(faults).toHaveText(String(score))
        await expect(points).toHaveText(String(score))
      }
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
    }
    const field = (await board.boundingBox())!
    await page.touchscreen.tap(field.x + 10, field.y + 10)
    await expect(faults).toHaveText(String(score + 1))

    await page.getByRole('link', { name: 'Volver a SAVRA' }).tap()
    await expect(page).toHaveURL(/\/$/)
    await page.getByRole('link', { name: 'SAVRA Break', exact: true }).tap()
    await page.getByRole('link', { name: 'SAVRA Reflex' }).tap()
    await expect(start).toBeVisible()
    await expect(target).toHaveCount(0)
    expect(mutations).toEqual([])
  })
})

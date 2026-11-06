// Rebuild only the public share card and icons from SAVRA's official assets.
// Run from frontend: node scripts/generate-branding.mjs (Playwright Chromium required).
import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const publicRoot = path.join(root, 'public')
const data = async file => (await readFile(path.join(root, file))).toString('base64')
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const assets = await page.evaluate(async ({ logo, symbol, font }) => {
    const face = new FontFace('Manrope', `url(data:font/woff2;base64,${font})`, { weight: '200 800' })
    document.fonts.add(await face.load())
    const load = async source => { const img = new Image(); img.src = `data:image/png;base64,${source}`; await img.decode(); return img }
    const wordmark = await load(logo)
    const isotipo = await load(symbol)
    const render = (width, height, draw) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d'); draw(ctx)
      return canvas.toDataURL('image/png').split(',')[1]
    }
    const output = {}
    for (const size of [16, 32, 48, 192, 512]) {
      output[size] = render(size, size, ctx => {
        const h = size * isotipo.height / isotipo.width
        ctx.drawImage(isotipo, 0, (size - h) / 2, size, h)
      })
    }
    output.apple = render(180, 180, ctx => {
      ctx.fillStyle = '#E4E6EA'; ctx.fillRect(0, 0, 180, 180)
      ctx.drawImage(isotipo, 18, 18 + (144 - 144 * isotipo.height / isotipo.width) / 2, 144, 144 * isotipo.height / isotipo.width)
    })
    output.social = render(1200, 630, ctx => {
      ctx.fillStyle = '#E4E6EA'; ctx.fillRect(0, 0, 1200, 630)
      ctx.drawImage(wordmark, 72, 60, 350, 350 * wordmark.height / wordmark.width)
      ctx.fillStyle = '#2B2D33'; ctx.textBaseline = 'alphabetic'
      ctx.font = '650 15px Manrope'; ctx.textAlign = 'right'
      ctx.fillText('ENCUESTA VOLUNTARIA', 1128, 94)
      ctx.textAlign = 'left'; ctx.font = '650 16px Manrope'
      ctx.fillText('VOCES UNIVERSITARIAS · COLOMBIA', 76, 230)
      ctx.font = '800 76px Manrope'
      ctx.fillText('Tu experiencia', 70, 329)
      ctx.font = '400 76px Manrope'
      ctx.fillText('universitaria cuenta.', 70, 419)
      ctx.drawImage(isotipo, 1016, 316, 112, 112 * isotipo.height / isotipo.width)
      ctx.fillStyle = '#2B2D33'; ctx.fillRect(76, 501, 1052, 1)
      ctx.fillStyle = '#F2412C'; ctx.fillRect(76, 500, 58, 3)
      ctx.fillStyle = '#2B2D33'; ctx.font = '500 18px Manrope'
      ctx.fillText('Experiencia académica · Movilidad · Permanencia', 76, 555)
      ctx.textAlign = 'right'; ctx.font = '650 17px Manrope'
      ctx.fillText('savra-wacb.onrender.com', 1128, 555)
      ctx.fillStyle = '#F2412C'; ctx.fillRect(0, 620, 1200, 10)
    })
    return output
  }, {
    logo: await data('public/branding/logo_savra.png'), symbol: await data('public/branding/isotipo_savra.png'),
    font: await data('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'),
  })
  const files = { 'favicon-16x16.png': assets[16], 'favicon-32x32.png': assets[32],
    'icon-192.png': assets[192], 'icon-512.png': assets[512], 'apple-touch-icon.png': assets.apple,
    'branding/savra-social.png': assets.social }
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(publicRoot, name), Buffer.from(value, 'base64'))
  // ICO container with PNG entries (Windows Vista+ and current browsers).
  const sizes = [16, 32, 48]
  const entries = sizes.map(size => Buffer.from(assets[size], 'base64'))
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, index) => {
    const start = 6 + index * 16
    header[start] = size; header[start + 1] = size
    header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6)
    header.writeUInt32LE(entries[index].length, start + 8); header.writeUInt32LE(offset, start + 12)
    offset += entries[index].length
  })
  await writeFile(path.join(publicRoot, 'favicon.ico'), Buffer.concat([header, ...entries]))
  console.log('Generated SAVRA icons and 1200 × 630 share card from official assets.')
} finally { await browser.close() }

import { test } from '@playwright/test'
import { createServer } from 'node:https'
import { request as forward } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let edge: ReturnType<typeof createServer>
test.beforeAll(async () => {
  edge = createServer({ key: readFileSync(join(process.env.SAVRA_E2E_TLS!, 'key.pem')),
    cert: readFileSync(join(process.env.SAVRA_E2E_TLS!, 'cert.pem')) }, (incoming, outgoing) => {
    const upstream = forward({ hostname: '127.0.0.1', port: 8083, method: incoming.method, path: incoming.url,
      headers: { ...incoming.headers, 'x-forwarded-proto': 'https' } }, response => {
      outgoing.writeHead(response.statusCode!, response.rawHeaders); response.pipe(outgoing)
    })
    upstream.on('error', () => outgoing.writeHead(502).end())
    incoming.pipe(upstream)
  })
  await new Promise<void>((resolve, reject) => edge.once('error', reject).listen(8443, '127.0.0.1', resolve))
})
test.afterAll(async () => { if (edge?.listening) await new Promise<void>(resolve => edge.close(() => resolve())) })

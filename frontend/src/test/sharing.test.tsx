import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import ShareSavra from '@/components/ShareSavra'
import { SAVRA_URL, SHARE_DATA, SHARE_INVITATION, WHATSAPP_URL } from '@/lib/sharing'

afterEach(() => vi.unstubAllGlobals())

function capabilities(share?: ReturnType<typeof vi.fn>, writeText?: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('navigator', { share, clipboard: writeText ? { writeText } : undefined })
}

test('opens native sharing with the invitation and canonical public URL', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  capabilities(share)
  render(<ShareSavra />)
  fireEvent.click(screen.getByRole('button', { name: 'Compartir SAVRA' }))
  await waitFor(() => expect(share).toHaveBeenCalledWith(SHARE_DATA))
  expect(share.mock.calls[0][0].url).toBe(SAVRA_URL)
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})

test('native cancellation is normal and never displays an error or opens the fallback', async () => {
  capabilities(vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')))
  render(<ShareSavra />)
  fireEvent.click(screen.getByRole('button', { name: 'Compartir SAVRA' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Compartir SAVRA' })).toBeEnabled())
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument()
})

test('native failure offers actionable alternatives', async () => {
  capabilities(vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')))
  render(<ShareSavra />)
  fireEvent.click(screen.getByRole('button', { name: 'Compartir SAVRA' }))
  expect(await screen.findByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', WHATSAPP_URL)
  expect(screen.getByRole('status')).toHaveTextContent('Puedes compartir por WhatsApp')
})

test('browsers without native sharing can open alternatives from the main button', () => {
  capabilities()
  render(<ShareSavra />)
  fireEvent.click(screen.getByRole('button', { name: 'Compartir SAVRA' }))
  expect(screen.getByRole('button', { name: 'Más opciones' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('link', { name: /WhatsApp/ })).toBeVisible()
})

test('WhatsApp is directly available even with native sharing and preserves accents and line breaks', () => {
  capabilities(vi.fn())
  render(<ShareSavra />)
  fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }))
  const link = screen.getByRole('link', { name: /WhatsApp/ })
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(new URL(link.getAttribute('href')!).searchParams.get('text')).toBe(SHARE_INVITATION)
  expect(SHARE_INVITATION).toContain(`\n\n${SAVRA_URL}`)
})

test.each([
  ['Copiar enlace', SAVRA_URL, 'Enlace copiado.'],
  ['Copiar invitación', SHARE_INVITATION, 'Invitación copiada.'],
])('%s writes only the public content and announces success', async (label, text, confirmation) => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  capabilities(undefined, writeText)
  render(<ShareSavra />)
  fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }))
  fireEvent.click(screen.getByRole('button', { name: label }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(confirmation))
  expect(writeText).toHaveBeenCalledExactlyOnceWith(text)
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
})

test.each([false, true])(
  'unavailable or denied clipboard provides selected manual copy without false success (%s)', async denied => {
    capabilities(undefined, denied ? vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) : undefined)
    render(<ShareSavra />)
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copiar invitación' }))
    const field = await screen.findByLabelText('Texto para copiar')
    expect(field).toHaveValue(SHARE_INVITATION)
    expect(field).toHaveFocus()
    expect((field as HTMLTextAreaElement).selectionEnd).toBe(SHARE_INVITATION.length)
    expect(screen.getByRole('status')).not.toHaveTextContent('copiada')
  },
)

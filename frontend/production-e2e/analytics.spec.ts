import { test, expect } from '@playwright/test'
import './edge'

test('movilidad real: cobertura histórica, Sankey y mapas seguros con fixture aislada', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/observatorio/academico')
  await page.getByRole('button', { name: 'Movilidad estudiantil', exact: true }).click()
  const flow = page.getByTestId('chart-transport_mode__commute_time')
  await expect(flow).toHaveAttribute('data-view', 'sankey')
  await expect(flow.locator('svg')).toBeVisible()
  await expect.poll(() => flow.evaluate(el => Math.abs(el.clientWidth - Number(el.querySelector('svg')?.getAttribute('width'))))).toBeLessThan(2)
  await expect.poll(() => flow.locator('svg').textContent()).toContain('minutos')
  await expect(page.getByTestId('chart-relocated_for_study')).toBeVisible()
  await expect(page.getByTestId('chart-preferred_support')).toBeVisible()
  await expect(page.getByTestId('chart-mobility_delay__dropout_thoughts')).toHaveAttribute('data-view', 'heatmap')
  const result = await page.evaluate(async () => (await (await fetch('/api/analytics/academic')).json()))
  expect(result.eligible_responses).toBe(40)
  expect(result.mobility.flow.denominator).toBe(20)
  expect(result.mobility.flow.missing).toBe(20)
  expect(result.data_mode).toBe('real')
  expect(await page.getByText('DATOS SIMULADOS — DEMOSTRACIÓN TÉCNICA').count()).toBe(0)
  // Visible only in test screenshots; the application source contains no fixture banner.
  await page.evaluate(() => {
    const label = document.createElement('p'); label.textContent = 'VERIFICACIÓN · DATOS AISLADOS DE PRUEBA'
    label.className = 'instrument-note'; document.querySelector('.mobility-section')!.prepend(label)
  })
  await page.locator('.mobility-section').screenshot({ path: '../.local/areas-v2-audit/mobility-desktop.png', animations: 'disabled' })
  await page.getByLabel('Variable de movilidad para comparar').selectOption('relocated_for_study__main_difficulty')
  await expect(page.getByTestId('chart-relocated_for_study__main_difficulty')).toHaveAttribute('data-view', 'heatmap')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('.mobility-section').screenshot({ path: '../.local/areas-v2-audit/mobility-mobile.png' })
  await page.goto('/observatorio/datos')
  await expect(page.getByRole('table', { name: 'Cobertura por pregunta' })).toContainText('Cambio de municipio')
  await expect(page.getByText('Desde savra-integrada-v2').first()).toBeVisible()
  expect(errors).toEqual([])
})

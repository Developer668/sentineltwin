import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SatelliteAssessmentModal } from './SatelliteAssessmentModal'
import type { LocationRisk, RuntimeContext } from '../types'

const location: LocationRisk = {
  id: 'loc-1',
  name: 'Santa Rosa Wildland Edge',
  county: 'Sonoma County, CA',
  risk: 'high',
  hazards: ['fire'],
  impactWindow: '6–24 hrs',
  fireScore: 82,
  seismicScore: 48,
  x: 30,
  y: 28,
}

const productionRuntime: RuntimeContext = {
  source: 'cockroachdb',
  apiConnected: true,
  persistence: 'cockroachdb',
  memoryProvider: 'cockroachdb',
  label: 'CockroachDB live',
  detail: 'Persistent API',
}

describe('SatelliteAssessmentModal source truth', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('disables deterministic imagery and defaults to Sentinel-2 when persistence is live', async () => {
    await act(async () => root.render(
      <SatelliteAssessmentModal
        open
        location={location}
        runtime={productionRuntime}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onComplete={vi.fn()}
      />,
    ))

    const demo = container.querySelector<HTMLButtonElement>('[data-imagery-mode="demo"]')
    const openData = container.querySelector<HTMLButtonElement>('[data-imagery-mode="open-data"]')
    expect(demo?.disabled).toBe(true)
    expect(demo?.getAttribute('aria-checked')).toBe('false')
    expect(openData?.getAttribute('aria-checked')).toBe('true')
    expect(container.textContent).toContain('Real Sentinel-2 L2A imagery')
  })

  it('keeps the explicit deterministic tile available in demo mode', async () => {
    await act(async () => root.render(
      <SatelliteAssessmentModal
        open
        location={location}
        runtime={{ ...productionRuntime, source: 'api-demo', persistence: 'ephemeral', label: 'Connected demo' }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onComplete={vi.fn()}
      />,
    ))

    const demo = container.querySelector<HTMLButtonElement>('[data-imagery-mode="demo"]')
    expect(demo?.disabled).toBe(false)
    expect(demo?.getAttribute('aria-checked')).toBe('true')
    expect(container.textContent).toContain('Synthetic California terrain · demo input')
  })
})

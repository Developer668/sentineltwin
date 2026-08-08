import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandHero } from './CommandHero'
import { EvidenceCarousel } from './EvidenceCarousel'
import type { AgentActivity, MemoryEvent, ResilienceEvidence, RuntimeContext } from '../types'

const memory: MemoryEvent = {
  id: 'memory-1',
  title: 'Santa Rosa wildfire precedent',
  detail: 'Early shelter staging preserved evacuation capacity.',
  location: 'Santa Rosa, CA',
  similarity: 0.91,
  source: 'test memory',
}

const activities: AgentActivity[] = [{
  id: 'activity-1',
  time: '14:22',
  agent: 'risk_assessor',
  action: 'Assessment ready',
  detail: 'Source evidence normalized for review.',
  status: 'complete',
}]

const resilience: ResilienceEvidence = {
  topologyVerified: false,
  survivalGoal: null,
  topologySource: 'test:unverified',
  configuredRpoSeconds: null,
  observedRpoSeconds: null,
}

const runtime: RuntimeContext = {
  source: 'api-demo',
  apiConnected: true,
  persistence: 'ephemeral',
  memoryProvider: 'deterministic-in-memory',
  label: 'Connected demo',
  detail: 'Ephemeral runtime',
}

describe('editorial command experience', () => {
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

  it('keeps the command hero focused on exactly two high-contrast actions', async () => {
    const onRunSimulation = vi.fn()
    const onAssessSatellite = vi.fn()
    await act(async () => root.render(<CommandHero onRunSimulation={onRunSimulation} onAssessSatellite={onAssessSatellite} />))

    const actions = Array.from(container.querySelectorAll<HTMLButtonElement>('.hero-actions button'))
    expect(actions).toHaveLength(2)
    expect(container.querySelector('h1')?.textContent).toContain('Model cascading')

    await act(async () => actions[0].click())
    await act(async () => actions[1].click())
    expect(onRunSimulation).toHaveBeenCalledOnce()
    expect(onAssessSatellite).toHaveBeenCalledOnce()
  })

  it('cycles evidence without inventing topology or continuity proof', async () => {
    await act(async () => root.render(<EvidenceCarousel memory={memory} activities={activities} resilience={resilience} runtime={runtime} />))
    expect(container.textContent).toContain('Santa Rosa wildfire precedent')

    const next = container.querySelector<HTMLButtonElement>('button[aria-label="Next evidence"]')
    await act(async () => next?.click())
    expect(container.textContent).toContain('Assessment ready')

    await act(async () => next?.click())
    expect(container.textContent).toContain('Routing labels only')
    expect(container.textContent).toContain('does not claim quorum')
  })
})

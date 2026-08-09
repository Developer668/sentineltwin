import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimulationModal } from './SimulationModal'
import type { LocationRisk, RuntimeContext, SatelliteAssessment, SimulationResult } from '../types'

const location: LocationRisk = {
  id: 'loc-1',
  name: 'Sacramento Delta',
  county: 'Sacramento County, CA',
  risk: 'elevated',
  hazards: ['fire'],
  impactWindow: '24–48 hrs',
  fireScore: 68,
  seismicScore: 31,
  x: 45,
  y: 35,
}

const runtime: RuntimeContext = {
  source: 'cockroachdb',
  apiConnected: true,
  persistence: 'cockroachdb',
  memoryProvider: 'cockroachdb',
  label: 'CockroachDB live',
  detail: 'Persistent API',
}

const assessment: SatelliteAssessment = {
  id: 'assessment-sentinel-2-1',
  locationId: location.id,
  status: 'complete',
  fireRisk: 81,
  earthquakeRisk: 22,
  combinedRisk: 65,
  confidence: 91,
  summary: 'Dry cultivated terrain observed.',
  observations: ['Low surface moisture'],
  provider: 'amazon-bedrock',
  objectKey: 'sentineltwin/quarantine/loc-1/sentinel2.jp2',
  source: {
    malware_scan_status: 'NOT_APPLICABLE_TRUSTED_SOURCE',
    content_validation_provider: 'sentineltwin-allowlisted-aws-open-data',
    content_validation_status: 'SOURCE_HASH_VERIFIED',
    upstream: { provider: 'aws-open-data-sentinel-2-l2a' },
  },
  createdAt: '2026-08-08T20:00:00Z',
  runtime,
  persisted: true,
}

const result: SimulationResult = {
  runId: 'sim-agriculture-1',
  hazard: 'agricultural_resilience',
  status: 'complete',
  planVersion: 'v1.0',
  confidence: 73,
  retrievedMemories: 1,
  recalledMemoryIds: ['mem-1'],
  learnedMemoryId: 'mem-2',
  learningLoop: 'retrieve → simulate → plan → persist outcome',
  planProvider: 'amazon-bedrock',
  recommendations: ['Ground-truth stressed parcels'],
  runtime,
  persisted: true,
}

describe('SimulationModal agricultural resilience evidence flow', () => {
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

  it('submits named assumptions with the selected durable Sentinel-2 assessment', async () => {
    const onSubmit = vi.fn().mockResolvedValue(result)
    await act(async () => root.render(
      <SimulationModal
        open
        location={location}
        runtime={runtime}
        initialLayer="composite"
        assessment={assessment}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        onComplete={vi.fn()}
      />,
    ))

    await act(async () => container.querySelector<HTMLButtonElement>('[data-hazard="agricultural_resilience"]')?.click())
    expect(container.textContent).toContain('Persisted Sentinel-2 evidence ready')
    expect(container.textContent).toContain('amazon-bedrock')
    expect(container.textContent).toContain('Scenario assumptions—not observed weather')

    const run = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Run simulation'))
    await act(async () => run?.click())

    expect(onSubmit).toHaveBeenCalledWith({
      locationId: location.id,
      hazard: 'agricultural_resilience',
      intensity: 82,
      horizonHours: 72,
      cascadingImpacts: ['Power grid', 'Transportation', 'Water systems'],
      useMemory: true,
      assessmentId: assessment.id,
      rainfallDeficitPercent: 35,
      heatAnomalyC: 2,
      irrigationCoverage: .4,
    })
  })

  it('does not enable agriculture for an unverified persisted upload', async () => {
    const onSubmit = vi.fn()
    await act(async () => root.render(
      <SimulationModal
        open
        location={location}
        runtime={runtime}
        initialLayer="agricultural_resilience"
        assessment={{
          ...assessment,
          source: { malware_scan_status: 'NO_THREATS_FOUND' },
        }}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        onComplete={vi.fn()}
      />,
    ))

    expect(container.textContent).toContain('Persisted Sentinel-2 evidence required')
    const run = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Run simulation'))
    expect(run?.disabled).toBe(true)
    await act(async () => run?.click())
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

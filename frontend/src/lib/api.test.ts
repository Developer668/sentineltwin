import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiRuntime, resolveApiBaseUrl, SentinelApiError, sentinelApi } from './api'
import { cognitoAuth } from './auth'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

const liveLocation = {
  id: 'loc-santa-rosa',
  name: 'Santa Rosa',
  region: 'Sonoma County',
  latitude: 38.44,
  longitude: -122.71,
  fire_risk: .92,
  earthquake_risk: .68,
  combined_risk: .85,
  status: 'critical',
}

const simulationRequest = {
  locationId: 'loc-santa-rosa',
  hazard: 'composite' as const,
  intensity: 84,
  horizonHours: 24,
  cascadingImpacts: ['Power grid'],
  useMemory: true,
}

const uploadTicket = {
  data: {
    upload_url: 'https://example-bucket.s3.amazonaws.com/',
    object_key: 'sentineltwin/quarantine/loc-1/tile.png',
    method: 'POST',
    fields: { key: 'sentineltwin/quarantine/loc-1/tile.png', policy: 'signed-policy' },
    expires_in: 600,
  },
  meta: { mode: 'production', memory_provider: 'cockroachdb' },
}

const completedAssessment = {
  assessment: {
    id: 'assessment-1',
    location_id: 'loc-1',
    provider: 'amazon-bedrock',
    persisted: true,
    fire_risk: .84,
    earthquake_risk: .62,
    combined_risk: .75,
    confidence: .88,
    summary: 'Dry vegetation and steep terrain detected.',
    observations: ['Dry vegetation', 'Steep terrain'],
    source: { object_key: 'sentineltwin/quarantine/loc-1/tile.png' },
  },
  status: 'completed',
  object_key: 'sentineltwin/quarantine/loc-1/tile.png',
  ingestion_authority: 'guardduty-eventbridge',
}

describe('sentinelApi source, error, and persistence contracts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
    cognitoAuth.signOut()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('uses the actual zero-setup local API port by default', () => {
    expect(apiRuntime.baseUrl).toBe('http://127.0.0.1:8787')
    expect(apiRuntime.configurationError).toBeNull()
  })

  it('allows HTTPS stage prefixes and explicit loopback HTTP while rejecting unsafe remote URLs', () => {
    expect(resolveApiBaseUrl('api.example.com')).toEqual({ baseUrl: 'https://api.example.com', valid: true })
    expect(resolveApiBaseUrl('http://localhost:8787')).toEqual({ baseUrl: 'http://localhost:8787', valid: true })
    expect(resolveApiBaseUrl('http://127.0.0.1:8787')).toEqual({ baseUrl: 'http://127.0.0.1:8787', valid: true })
    expect(resolveApiBaseUrl('https://example.execute-api.us-west-2.amazonaws.com/prod/')).toEqual({
      baseUrl: 'https://example.execute-api.us-west-2.amazonaws.com/prod',
      valid: true,
    })
    expect(resolveApiBaseUrl('http://api.example.com')).toMatchObject({ baseUrl: '', valid: false, error: expect.stringContaining('HTTPS') })
    expect(resolveApiBaseUrl('https://api.example.com/prod?debug=1')).toMatchObject({ baseUrl: '', valid: false, error: expect.stringContaining('query') })
    expect(resolveApiBaseUrl('https://api.example.com/prod#debug')).toMatchObject({ baseUrl: '', valid: false, error: expect.stringContaining('fragment') })
    expect(resolveApiBaseUrl('https://api.example.com/prod/%2e%2e/admin')).toMatchObject({ baseUrl: '', valid: false, error: expect.stringContaining('unsafe') })
    expect(resolveApiBaseUrl('https://user:secret@api.example.com')).toMatchObject({ baseUrl: '', valid: false, error: expect.stringContaining('credentials') })
  })

  it('returns an explicitly non-persistent snapshot when the network is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const result = await sentinelApi.getDashboard()
    expect(result.runtime).toMatchObject({ source: 'offline-snapshot', apiConnected: false, persistence: 'none' })
    expect(result.data.locations[0].name).toBe('Santa Rosa')
    expect(result.data.memory.source).not.toContain('CockroachDB')
    expect(result.data.timeline.some((item) => /persist|commit/i.test(`${item.title} ${item.detail}`))).toBe(false)
  })

  it('surfaces an HTTP dashboard error while downgrading the visible data to a snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { error: { message: 'Authentication required' } } }, false, 401)))
    const result = await sentinelApi.getDashboard()
    expect(result.runtime).toMatchObject({ source: 'offline-snapshot', persistence: 'none' })
    expect(result.error).toMatchObject({ status: 401, kind: 'http' })
  })

  it('does not label a malformed production dashboard response as live Cockroach data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { locations: [] },
      meta: { mode: 'production', memory_provider: 'cockroachdb' },
    })))
    const result = await sentinelApi.getDashboard()
    expect(result.runtime).toMatchObject({ source: 'offline-snapshot', persistence: 'none' })
    expect(result.error).toMatchObject({ kind: 'contract' })
  })

  it('distinguishes a connected deterministic API from durable CockroachDB', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { locations: [liveLocation], recent_memories: [{ id: 'mem-1', title: 'Demo memory', content: 'In-process state' }] },
      meta: { mode: 'demo', memory_provider: 'deterministic-in-memory' },
    })))

    const result = await sentinelApi.getDashboard()
    expect(result.runtime).toMatchObject({ source: 'api-demo', apiConnected: true, persistence: 'ephemeral' })
    expect(result.data.memory.source).toBe('Deterministic API memory · ephemeral')
    expect(result.data.timeline.some((item) => /CockroachDB|committed to all regions/i.test(item.detail))).toBe(false)
  })

  it('marks Cockroach persistence without inventing topology evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        locations: [liveLocation],
        recent_memories: [{ id: 'mem-live', title: 'Durable memory', content: 'Stored outcome' }],
        resilience: { topology_verified: false, configured_rpo_seconds: 5, observed_rpo_seconds: 0 },
      },
      meta: { mode: 'production', memory_provider: 'cockroachdb' },
    })))

    const result = await sentinelApi.getDashboard()
    expect(result.runtime).toMatchObject({ source: 'cockroachdb', persistence: 'cockroachdb' })
    expect(result.data.memory.source).toContain('CockroachDB')
    expect(result.data.resilience).toMatchObject({ topologyVerified: false, configuredRpoSeconds: null, observedRpoSeconds: null })
  })

  it('normalizes provider, recall, recommendations, and learned-memory evidence for a durable simulation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        id: 'sim-live-1',
        status: 'completed',
        plan_version: 'v1.2',
        memory_context: {
          retrieved_count: 2,
          memory_ids: ['mem-a', 'mem-b'],
          learned_memory_id: 'mem-live-2',
          loop: 'retrieve → simulate → plan → persist outcome',
        },
        agent_plan: { provider: 'deterministic-planner', recommendations: ['Stage crews', 'Open shelters'] },
        outcome: { resilience_score: 91.4 },
        learned_memory: { id: 'mem-live-2' },
      },
      meta: { mode: 'production', memory_provider: 'cockroachdb' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sentinelApi.runSimulation(simulationRequest)
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(request).toMatchObject({ location_id: 'loc-santa-rosa', hazard: 'multi_hazard' })
    expect(result).toMatchObject({
      runId: 'sim-live-1',
      confidence: 91,
      retrievedMemories: 2,
      recalledMemoryIds: ['mem-a', 'mem-b'],
      learnedMemoryId: 'mem-live-2',
      planProvider: 'deterministic-planner',
      recommendations: ['Stage crews', 'Open shelters'],
      persisted: true,
    })
  })

  it('requires a learned-memory id before claiming a production simulation was persisted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { id: 'sim-no-memory', memory_context: { retrieved_count: 4 }, outcome: { resilience_score: 82 } },
      meta: { mode: 'production', memory_provider: 'cockroachdb' },
    })))
    const result = await sentinelApi.runSimulation(simulationRequest)
    expect(result.persisted).toBe(false)
    expect(result.learnedMemoryId).toBeNull()
  })

  it('keeps a connected deterministic simulation explicitly ephemeral', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { id: 'sim-demo-1', memory_context: { retrieved_count: 4 }, outcome: { resilience_score: 82 } },
      meta: { mode: 'demo', memory_provider: 'deterministic-in-memory' },
    })))

    const result = await sentinelApi.runSimulation(simulationRequest)
    expect(result).toMatchObject({ persisted: false, runtime: { source: 'api-demo', persistence: 'ephemeral' } })
    expect(result.learningLoop).toContain('ephemeral API state')
    expect(result.learningLoop).not.toContain('persist outcome')
  })

  it('uses a truthful offline simulation preview only when the network is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')))
    const result = await sentinelApi.runSimulation(simulationRequest)
    expect(result).toMatchObject({ persisted: false, runtime: { source: 'offline-snapshot', persistence: 'none' }, planProvider: 'local-deterministic-preview' })
  })

  it('does not turn a 401 simulation response into a successful local preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { error: { message: 'Authentication required' } } }, false, 401)))
    await expect(sentinelApi.runSimulation(simulationRequest)).rejects.toMatchObject({ status: 401, kind: 'http' })
  })

  it('treats a persistent routing rehearsal as logical-only without explicit topology and failover evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        status: 'rehearsal_completed',
        rehearsal_only: true,
        actual_region_failover_performed: false,
        topology_verified: false,
        from_region: 'us-west-2',
        logical_active_region: 'us-east-1',
        active_region_scope: 'application-routing-label',
        configured_rpo_seconds: 5,
        observed_rpo_seconds: 0,
        memory_transaction_verified: true,
        memory_check: { scope: 'same CockroachDB serializable transaction read-after-write', durable: true },
      },
      meta: { mode: 'production', memory_provider: 'cockroachdb' },
    })))

    const result = await sentinelApi.simulateOutage('us-west-2')
    expect(result).toMatchObject({
      rehearsalOnly: true,
      actualRegionFailoverPerformed: false,
      topologyVerified: false,
      configuredRpoSeconds: null,
      observedRpoSeconds: null,
      memoryTransactionVerified: true,
      memoryCheckDurable: true,
      logicalActiveRegion: 'us-east-1',
    })
  })

  it('retains verified topology configuration but never reports observed RPO for a rehearsal-only response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        rehearsal_only: true,
        actual_region_failover_performed: false,
        topology_verified: true,
        survival_goal: 'REGION FAILURE',
        regions: [
          { name: 'us-west-2', role: 'primary', status: 'configured' },
          { name: 'us-east-1', role: 'database region', status: 'configured' },
          { name: 'eu-central-1', role: 'database region', status: 'configured' },
        ],
        configured_rpo_seconds: 5,
        observed_rpo_seconds: 0,
        memory_transaction_verified: true,
        memory_check: { durable: true, scope: 'same transaction' },
      },
      meta: { mode: 'production', memory_provider: 'cockroachdb' },
    })))

    const result = await sentinelApi.simulateOutage('us-west-2')
    expect(result).toMatchObject({ topologyVerified: true, actualRegionFailoverPerformed: false, configuredRpoSeconds: 5, observedRpoSeconds: null })
    expect(result.regions).toHaveLength(3)
  })

  it('does not turn a forbidden failover rehearsal into a successful local result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { error: { message: 'Not authorized' } } }, false, 403)))
    await expect(sentinelApi.simulateOutage()).rejects.toMatchObject({ status: 403, kind: 'http' })
  })

  it('falls back locally only for a built-in demo tile when the network is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const result = await sentinelApi.assessSatellite({ locationId: 'santa-rosa', demoTile: 'california-terrain' })
    expect(result).toMatchObject({ provider: 'Local deterministic preview', persisted: false, runtime: { source: 'offline-snapshot' } })
    expect(result.summary).toContain('No model or cloud service')
  })

  it('does not hide a demo-tile validation error behind a local success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { error: { message: 'Invalid demo tile' } } }, false, 422)))
    await expect(sentinelApi.assessSatellite({ locationId: 'loc-1', demoTile: 'california-terrain' })).rejects.toMatchObject({ status: 422, kind: 'http' })
  })

  it('posts a demo tile directly to the assessment endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { ...completedAssessment.assessment, persisted: false },
      meta: { mode: 'demo', memory_provider: 'deterministic-in-memory' },
    }, true, 201))
    vi.stubGlobal('fetch', fetchMock)
    const result = await sentinelApi.assessSatellite({ locationId: 'loc-1', demoTile: 'california-terrain' })
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8787/api/assessments')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ location_id: 'loc-1', demo_tile: 'california-terrain' })
    expect(result).toMatchObject({ persisted: false, runtime: { source: 'api-demo' } })
  })

  it('uses the GuardDuty event lookup as the only post-upload assessment authority', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(uploadTicket, true, 201))
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce(jsonResponse({
        data: completedAssessment,
        meta: { mode: 'production', memory_provider: 'cockroachdb' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const stages: string[] = []

    const result = await sentinelApi.assessSatellite(
      { locationId: 'loc-1', file: new File(['pixels'], 'tile.png', { type: 'image/png' }) },
      (stage) => stages.push(stage),
    )

    const uploadInit = fetchMock.mock.calls[1][1]
    expect(uploadInit.method).toBe('POST')
    expect(uploadInit.body).toBeInstanceOf(FormData)
    expect((uploadInit.body as FormData).get('policy')).toBe('signed-policy')
    expect((uploadInit.body as FormData).get('file')).toBeInstanceOf(File)
    expect(fetchMock.mock.calls[2][0]).toBe('http://127.0.0.1:8787/api/assessments?object_key=sentineltwin%2Fquarantine%2Floc-1%2Ftile.png')
    expect(fetchMock.mock.calls[2][1].method).toBeUndefined()
    expect(fetchMock.mock.calls[2][1].body).toBeUndefined()
    expect(stages).toEqual(['authorizing', 'uploading', 'scanning'])
    expect(result).toMatchObject({
      fireRisk: 84,
      combinedRisk: 75,
      persisted: true,
      provider: 'amazon-bedrock',
      objectKey: 'sentineltwin/quarantine/loc-1/tile.png',
      ingestionAuthority: 'guardduty-eventbridge',
    })
  })

  it('polls a pending GuardDuty assessment until the completed record is available', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(uploadTicket, true, 201))
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce(jsonResponse({
        data: { assessment: null, status: 'pending', object_key: 'sentineltwin/quarantine/loc-1/tile.png', ingestion_authority: 'guardduty-eventbridge' },
        meta: { mode: 'production', memory_provider: 'cockroachdb' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: completedAssessment,
        meta: { mode: 'production', memory_provider: 'cockroachdb' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const assessmentPromise = sentinelApi.assessSatellite({ locationId: 'loc-1', file: new File(['pixels'], 'tile.png', { type: 'image/png' }) })
    await vi.advanceTimersByTimeAsync(1_500)
    const result = await assessmentPromise

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[3][0])
    expect(result.ingestionAuthority).toBe('guardduty-eventbridge')
  })

  it('imports a real allowlisted Sentinel-2 scene before GuardDuty polling', async () => {
    const sourceKey = 'tiles/10/S/EH/2024/7/15/0/R60m/TCI.jp2'
    const objectKey = 'sentineltwin/quarantine/loc-1/imported.jp2'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { status: 'quarantine_pending_scan', object_key: objectKey, provider: 'aws-open-data-sentinel-2-l2a' },
        meta: { mode: 'production', memory_provider: 'cockroachdb' },
      }, true, 202))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          ...completedAssessment,
          object_key: objectKey,
          ingestion_authority: 'guardduty-eventbridge',
          assessment: { ...completedAssessment.assessment, source: { object_key: objectKey } },
        },
        meta: { mode: 'production', memory_provider: 'cockroachdb' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const stages: string[] = []

    const result = await sentinelApi.assessSatellite(
      { locationId: 'loc-1', sentinelSourceKey: sourceKey },
      (stage) => stages.push(stage),
    )

    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8787/api/satellite/imports')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ location_id: 'loc-1', source_key: sourceKey })
    expect(fetchMock.mock.calls[1][0]).toContain(encodeURIComponent(objectKey))
    expect(stages).toEqual(['importing', 'scanning'])
    expect(result).toMatchObject({ objectKey, provider: 'amazon-bedrock', persisted: true })
  })

  it('stops polling when GuardDuty rejects quarantined imagery', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(uploadTicket, true, 201))
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce(jsonResponse({
        data: {
          assessment: null,
          status: 'rejected',
          malware_scan_status: 'THREATS_FOUND',
          object_key: 'sentineltwin/quarantine/loc-1/tile.png',
        },
        meta: { mode: 'production', memory_provider: 'cockroachdb' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sentinelApi.assessSatellite({
      locationId: 'loc-1',
      file: new File(['pixels'], 'tile.png', { type: 'image/png' }),
    })).rejects.toMatchObject({ status: 422, kind: 'http', message: expect.stringContaining('GuardDuty') })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rethrows an invalid object-key lookup instead of retrying or creating a duplicate assessment', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(uploadTicket, true, 201))
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce(jsonResponse({ data: { error: { message: 'object_key is outside the server-issued satellite prefix' } } }, false, 422))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sentinelApi.assessSatellite({ locationId: 'loc-1', file: new File(['pixels'], 'tile.png', { type: 'image/png' }) }))
      .rejects.toMatchObject({ status: 422, kind: 'http' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('blocks an insecure configured API before any request is sent', async () => {
    vi.stubEnv('VITE_API_URL', 'http://api.example.com')
    vi.resetModules()
    const isolatedApi = await import('./api')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(isolatedApi.sentinelApi.runSimulation(simulationRequest)).rejects.toEqual(expect.objectContaining({
      kind: 'contract',
      message: expect.stringContaining('HTTPS'),
    }) as SentinelApiError)
    expect(isolatedApi.apiRuntime.baseUrl).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('joins API requests after a validated API Gateway stage prefix', async () => {
    vi.stubEnv('VITE_API_URL', 'https://example.execute-api.us-west-2.amazonaws.com/prod/')
    vi.resetModules()
    const isolatedApi = await import('./api')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { id: 'sim-stage', memory_context: {}, outcome: { resilience_score: 80 } },
      meta: { mode: 'demo', memory_provider: 'deterministic-in-memory' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await isolatedApi.sentinelApi.runSimulation(simulationRequest)

    expect(isolatedApi.apiRuntime.baseUrl).toBe('https://example.execute-api.us-west-2.amazonaws.com/prod')
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.execute-api.us-west-2.amazonaws.com/prod/api/simulations')
  })
})

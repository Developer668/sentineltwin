import { demoDashboard, demoOutageResult, demoSimulationResult, offlineRuntime } from '../data/demoData'
import type {
  DashboardData,
  OutageResult,
  RuntimeContext,
  SatelliteAssessment,
  SatelliteAssessmentRequest,
  SatelliteAssessmentStage,
  SatelliteUploadTicket,
  SimulationRequest,
  SimulationResult,
} from '../types'
import { cognitoAuth } from './auth'

const DEFAULT_API_BASE = 'http://127.0.0.1:8787'

export interface ResolvedApiBaseUrl {
  baseUrl: string
  valid: boolean
  error?: string
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

export function resolveApiBaseUrl(configured?: string): ResolvedApiBaseUrl {
  const raw = configured?.trim()
  if (!raw) return { baseUrl: DEFAULT_API_BASE, valid: true }

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
  const looksLoopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(raw)
  const candidate = hasScheme ? raw : `${looksLoopback ? 'http' : 'https'}://${raw}`
  try {
    const parsed = new URL(candidate)
    if (parsed.username || parsed.password) {
      return { baseUrl: '', valid: false, error: 'VITE_API_URL must not contain embedded credentials.' }
    }
    if (parsed.search || parsed.hash) {
      return { baseUrl: '', valid: false, error: 'VITE_API_URL must not contain a query or fragment.' }
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
      return { baseUrl: '', valid: false, error: 'VITE_API_URL must use HTTPS; HTTP is allowed only for localhost, 127.0.0.1, or [::1].' }
    }
    const authorityEnd = candidate.indexOf('/', candidate.indexOf('//') + 2)
    const rawPath = authorityEnd < 0 ? '' : candidate.slice(authorityEnd).split(/[?#]/, 1)[0]
    const unsafeEncodedPath = /%(?:2e|2f|5c)/i.test(rawPath)
    const unsafeLiteralPath = /\\/.test(rawPath) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)
    const pathSegments = parsed.pathname.split('/').filter(Boolean)
    const invalidSegment = pathSegments.some((segment) => !/^[A-Za-z0-9._~$-]+$/.test(segment) || segment === '.' || segment === '..')
    if (unsafeEncodedPath || unsafeLiteralPath || invalidSegment || parsed.pathname.includes('//')) {
      return { baseUrl: '', valid: false, error: 'VITE_API_URL contains an unsafe API stage path.' }
    }
    const stagePrefix = parsed.pathname.replace(/\/+$/, '')
    return { baseUrl: `${parsed.origin}${stagePrefix}`, valid: true }
  } catch {
    return { baseUrl: '', valid: false, error: 'VITE_API_URL is not a valid API origin.' }
  }
}

const apiConfiguration = resolveApiBaseUrl(import.meta.env.VITE_API_URL as string | undefined)
const API_BASE = apiConfiguration.baseUrl

type JsonRecord = Record<string, unknown>
type ApiMeta = {
  mode?: unknown
  memory_provider?: unknown
  providers?: unknown
}
type ApiEnvelope<T> = { data: T; meta?: ApiMeta }

export type SentinelApiErrorKind = 'http' | 'network' | 'timeout' | 'contract' | 'processing-timeout'

export class SentinelApiError extends Error {
  constructor(message: string, public readonly status?: number, public readonly kind: SentinelApiErrorKind = 'contract') {
    super(message)
    this.name = 'SentinelApiError'
  }
}

export function describeApiError(error: unknown, operation: string): string {
  if (error instanceof SentinelApiError) {
    if (error.status === 401) return `Sign in with AWS Cognito to ${operation}, then retry.`
    if (error.status === 403) return `Your signed-in account is not authorized to ${operation}.`
    if (error.kind === 'timeout') return `The API timed out while trying to ${operation}. Retry when the service is responsive.`
    if (error.kind === 'processing-timeout') return `${error.message} The uploaded object remains in S3 and may finish processing; retry the lookup shortly.`
    if (error.status) return `${error.message} (${error.status}). Correct the request or service issue, then retry.`
    return error.message
  }
  return `SentinelTwin could not ${operation}. Retry after checking the API connection.`
}

function isNetworkUnavailable(error: unknown): boolean {
  return error instanceof SentinelApiError && error.kind === 'network'
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return isRecord(value) && 'data' in value
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asPercent(value: unknown, fallback = 0): number {
  const numeric = asNumber(value, fallback)
  return Math.round(Math.max(0, Math.min(100, numeric <= 1 ? numeric * 100 : numeric)))
}

function runtimeFrom(meta?: ApiMeta, payload?: unknown): RuntimeContext {
  const system = isRecord(payload) && isRecord(payload.system) ? payload.system : {}
  const mode = String(meta?.mode ?? system.mode ?? 'demo').toLowerCase()
  const memoryProvider = String(meta?.memory_provider ?? system.memory_provider ?? 'deterministic-in-memory')
  const isPersistent = mode === 'production' && memoryProvider.toLowerCase().includes('cockroach')

  if (isPersistent) {
    return {
      source: 'cockroachdb',
      apiConnected: true,
      persistence: 'cockroachdb',
      memoryProvider,
      label: 'CockroachDB live',
      detail: 'API connected; successful writes are durably persisted',
    }
  }

  return {
    source: 'api-demo',
    apiConnected: true,
    persistence: 'ephemeral',
    memoryProvider,
    label: 'Connected demo',
    detail: 'API connected to deterministic in-memory state; data may reset',
  }
}

function applyRuntimeTruth(data: DashboardData, runtime: RuntimeContext): DashboardData {
  const next = structuredClone(data)
  if (runtime.persistence === 'cockroachdb') return next

  next.memory.source = runtime.source === 'api-demo'
    ? 'Deterministic API memory · ephemeral'
    : 'Curated deterministic demo memory'
  next.timeline = next.timeline.map((event) => {
    if (!/persist|commit/i.test(`${event.title} ${event.detail}`)) return event
    return {
      ...event,
      title: 'Outcome available in demo',
      detail: runtime.source === 'api-demo' ? 'Ephemeral API state · may reset' : 'Bundled snapshot · no database write',
    }
  })
  return next
}

function normalizeDashboard(value: unknown, runtime: RuntimeContext): DashboardData | null {
  if (!isRecord(value) || !Array.isArray(value.locations) || value.locations.length === 0) return null
  const next = structuredClone(demoDashboard)
  const positions = [
    { x: 73, y: 80 }, { x: 67, y: 77 }, { x: 72, y: 73 }, { x: 29, y: 46 },
    { x: 78, y: 92 }, { x: 30, y: 29 }, { x: 64, y: 55 }, { x: 45, y: 35 },
  ]

  next.locations = value.locations.filter(isRecord).map((location, index) => {
    const fire = asPercent(location.fire_risk ?? location.fireScore, 50)
    const seismic = asPercent(location.earthquake_risk ?? location.seismicScore, 50)
    const level = String(location.status ?? '').toLowerCase()
    const risk = level === 'critical' || level === 'high' ? 'high' : level === 'guarded' ? 'moderate' : 'elevated'
    const longitude = asNumber(location.longitude, -119)
    const latitude = asNumber(location.latitude, 36)
    return {
      id: String(location.id ?? `live-location-${index}`),
      name: String(location.name ?? `Risk zone ${index + 1}`),
      county: `${String(location.region ?? 'California').replace(/, CA$/, '')}, CA`,
      risk,
      hazards: fire >= 65 && seismic >= 65 ? ['fire', 'seismic'] : fire >= seismic ? ['fire'] : ['seismic'],
      impactWindow: risk === 'high' ? '6–24 hrs' : risk === 'elevated' ? '24–48 hrs' : '24–72 hrs',
      fireScore: fire,
      seismicScore: seismic,
      x: Number.isFinite(longitude) ? Math.max(16, Math.min(86, 17 + ((longitude + 124.5) / 10.5) * 69)) : positions[index % positions.length].x,
      y: Number.isFinite(latitude) ? Math.max(8, Math.min(94, 8 + ((42 - latitude) / 10) * 86)) : positions[index % positions.length].y,
    }
  })

  const memories = Array.isArray(value.recent_memories) ? value.recent_memories : Array.isArray(value.recentMemories) ? value.recentMemories : []
  const memory = memories.find(isRecord)
  if (memory) {
    next.memory = {
      id: String(memory.id ?? next.memory.id),
      title: String(memory.title ?? next.memory.title),
      detail: String(memory.content ?? next.memory.detail),
      location: String(memory.location_name ?? next.locations[0].county),
      similarity: asNumber(memory.similarity ?? memory.confidence, next.memory.similarity),
      source: 'CockroachDB distributed vector index',
    }
  }

  const agents = Array.isArray(value.agents) ? value.agents.filter(isRecord) : []
  if (agents.length) {
    next.activities = agents.slice(0, 5).map((agent, index) => ({
      id: String(agent.id ?? `agent-${index}`),
      time: `14:${String(20 + Math.min(index, 2)).padStart(2, '0')}`,
      agent: String(agent.name ?? agent.role ?? `Agent ${index + 1}`),
      action: String(agent.last_action ?? agent.status ?? 'Memory synchronized'),
      detail: String(agent.description ?? agent.role ?? 'Operating on shared state'),
      status: 'complete' as const,
    }))
  }

  const simulations = Array.isArray(value.recent_simulations)
    ? value.recent_simulations.filter(isRecord)
    : Array.isArray(value.recentSimulations) ? value.recentSimulations.filter(isRecord) : []
  if (simulations.length) {
    const latest = simulations[0]
    const latestOutcome = isRecord(latest.outcome) ? latest.outcome : {}
    next.timeline = [
      { id: `t-${String(latest.id)}-1`, time: 'latest', title: 'Scenario completed', detail: `${String(latest.location_name ?? 'Selected zone')} · ${String(latest.hazard ?? 'multi-hazard').replaceAll('_', ' ')}`, status: 'complete' },
      { id: `t-${String(latest.id)}-2`, time: 'latest', title: 'Memory retrieved', detail: `${asNumber(isRecord(latest.memory_context) ? latest.memory_context.retrieved_count : 0)} relevant outcomes`, status: 'complete' },
      { id: `t-${String(latest.id)}-3`, time: 'latest', title: 'Plan generated', detail: `${asPercent(latestOutcome.resilience_score ?? latest.confidence)}% resilience score`, status: 'complete' },
      ...next.timeline.slice(0, 2),
    ]
  }

  const assessments = Array.isArray(value.recent_assessments)
    ? value.recent_assessments
    : Array.isArray(value.recentAssessments) ? value.recentAssessments : []
  next.assessments = assessments
    .filter(isRecord)
    .map((assessment) => normalizeAssessment(assessment, runtime))
    .filter((assessment) => assessment.persisted)

  const resilience = isRecord(value.resilience) ? value.resilience : null
  if (resilience) {
    const topologyVerified = resilience.topology_verified === true
    next.resilience = {
      topologyVerified,
      survivalGoal: resilience.survival_goal == null ? null : String(resilience.survival_goal),
      topologySource: String(resilience.topology_source ?? 'not reported'),
      configuredRpoSeconds: topologyVerified && resilience.configured_rpo_seconds != null ? asNumber(resilience.configured_rpo_seconds) : null,
      observedRpoSeconds: topologyVerified && resilience.observed_rpo_seconds != null ? asNumber(resilience.observed_rpo_seconds) : null,
    }
  }
  if (resilience && Array.isArray(resilience.regions) && resilience.regions.length) {
    const topologyVerified = resilience.topology_verified === true
    next.regions = resilience.regions.filter(isRecord).slice(0, 3).map((region, index) => ({
      id: index === 0 ? 'west' : index === 1 ? 'east' : 'eu',
      region: String(region.name ?? `region-${index + 1}`),
      locality: String(region.role ?? (index === 0 ? 'primary' : 'database region')),
      status: topologyVerified && ['healthy', 'configured'].includes(String(region.status)) ? 'healthy' as const : 'standby' as const,
    }))
  }

  next.updatedAt = new Date().toISOString()
  return next
}

function normalizeSimulation(value: unknown, runtime: RuntimeContext): SimulationResult {
  const raw = isRecord(value) && isRecord(value.simulation) ? value.simulation : value
  if (!isRecord(raw) || !raw.id) throw new SentinelApiError('Simulation response is missing an id')
  const memoryContext = isRecord(raw.memory_context) ? raw.memory_context : {}
  const outcome = isRecord(raw.outcome) ? raw.outcome : {}
  const agentPlan = isRecord(raw.agent_plan) ? raw.agent_plan : {}
  const learnedMemory = isRecord(raw.learned_memory) ? raw.learned_memory : {}
  const recalledMemoryIds = Array.isArray(memoryContext.memory_ids)
    ? memoryContext.memory_ids.map(String).filter(Boolean).slice(0, 8)
    : []
  const learnedMemoryIdValue = learnedMemory.id ?? memoryContext.learned_memory_id
  const learnedMemoryId = learnedMemoryIdValue == null || String(learnedMemoryIdValue).trim() === ''
    ? null
    : String(learnedMemoryIdValue)
  const recommendationSource = Array.isArray(agentPlan.recommendations)
    ? agentPlan.recommendations
    : Array.isArray(raw.recommendations) ? raw.recommendations : []
  const recommendations = recommendationSource
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 3)
  const resilience = asPercent(outcome.resilience_score ?? raw.confidence, 86)
  const persisted = runtime.persistence === 'cockroachdb' && learnedMemoryId !== null
  const rawHazard = String(raw.hazard ?? 'composite')
  const hazard: SimulationResult['hazard'] = rawHazard === 'agricultural_resilience'
    ? 'agricultural_resilience'
    : rawHazard === 'earthquake' ? 'seismic' : rawHazard === 'fire' ? 'fire' : 'composite'
  const evidence = isRecord(raw.evidence) ? raw.evidence : null
  const scenarioAssumptions = isRecord(raw.scenario_assumptions) ? raw.scenario_assumptions : null
  return {
    runId: String(raw.id),
    hazard,
    status: 'complete',
    planVersion: String(raw.plan_version ?? 'v1.0'),
    confidence: resilience,
    retrievedMemories: Math.max(recalledMemoryIds.length, Math.max(0, Math.round(asNumber(memoryContext.retrieved_count, 0)))),
    recalledMemoryIds,
    learnedMemoryId,
    learningLoop: persisted
      ? String(memoryContext.loop ?? 'retrieve → simulate → plan → persist outcome')
      : runtime.apiConnected
        ? 'retrieve → simulate → plan → retain in ephemeral API state'
        : 'local deterministic preview · no learned memory write',
    planProvider: String(agentPlan.provider ?? 'deterministic-planner'),
    recommendations,
    runtime,
    persisted,
    ...(hazard === 'agricultural_resilience' && evidence ? {
      evidence: {
        assessmentId: String(evidence.assessment_id ?? ''),
        provider: String(evidence.assessment_provider ?? 'unknown'),
        persistenceProvider: String(evidence.persistence_provider ?? 'unknown'),
        confidence: asPercent(evidence.confidence, 0),
        ...(evidence.created_at == null ? {} : { createdAt: String(evidence.created_at) }),
        ...(isRecord(evidence.source) ? { source: evidence.source } : {}),
      },
    } : {}),
    ...(hazard === 'agricultural_resilience' && scenarioAssumptions ? {
      scenarioAssumptions: {
        rainfallDeficitPercent: asNumber(scenarioAssumptions.rainfall_deficit_percent),
        heatAnomalyC: asNumber(scenarioAssumptions.heat_anomaly_c),
        irrigationCoverage: asPercent(scenarioAssumptions.irrigation_coverage),
        durationHours: asNumber(scenarioAssumptions.duration_hours),
      },
    } : {}),
    ...(hazard === 'agricultural_resilience' ? {
      agriculture: {
        cropStressScore: asPercent(outcome.crop_stress_score),
        waterDemandChangePercent: asNumber(outcome.water_demand_change_percent),
        erosionExposureScore: asPercent(outcome.erosion_exposure_score),
        wildfireDisruptionScore: asPercent(outcome.wildfire_disruption_score),
      },
    } : {}),
  }
}

function normalizeOutage(value: unknown, failedRegion: string, runtime: RuntimeContext): OutageResult {
  if (!isRecord(value)) throw new SentinelApiError('Invalid failover response')
  const topologyVerified = value.topology_verified === true
  const actualRegionFailoverPerformed = value.actual_region_failover_performed === true
  const memoryCheck = isRecord(value.memory_check) ? value.memory_check : {}
  const regions = Array.isArray(value.regions) ? value.regions.filter(isRecord).slice(0, 6).map((region, index) => ({
    id: `evidence-${index}`,
    region: String(region.name ?? `region-${index + 1}`),
    locality: String(region.role ?? 'database region'),
    status: topologyVerified && ['healthy', 'configured'].includes(String(region.status)) ? 'healthy' as const : 'standby' as const,
  })) : []
  return {
    requestedRegion: failedRegion,
    fromRegion: String(value.from_region ?? failedRegion),
    logicalActiveRegion: String(value.logical_active_region ?? value.active_region ?? ''),
    activeRegionScope: String(value.active_region_scope ?? 'application-routing-label'),
    rehearsalOnly: value.rehearsal_only !== false,
    actualRegionFailoverPerformed,
    topologyVerified,
    survivalGoal: value.survival_goal == null ? null : String(value.survival_goal),
    regions,
    configuredRpoSeconds: topologyVerified && value.configured_rpo_seconds != null ? asNumber(value.configured_rpo_seconds) : null,
    observedRpoSeconds: topologyVerified && actualRegionFailoverPerformed && value.observed_rpo_seconds != null ? asNumber(value.observed_rpo_seconds) : null,
    memoryTransactionVerified: value.memory_transaction_verified === true,
    memoryCheckScope: String(memoryCheck.scope ?? 'not reported'),
    memoryCheckDurable: memoryCheck.durable === true,
    notice: String(value.notice ?? 'Logical routing rehearsal completed.'),
    runtime,
  }
}

function normalizeUploadTicket(value: unknown): SatelliteUploadTicket {
  if (!isRecord(value)) throw new SentinelApiError('Upload authorization response is invalid')
  const uploadUrl = String(value.upload_url ?? value.uploadUrl ?? '')
  const objectKey = String(value.object_key ?? value.objectKey ?? value.s3_key ?? '')
  if (!uploadUrl || !objectKey) throw new SentinelApiError('Upload authorization did not include an S3 URL and object key')
  const rawHeaders = isRecord(value.headers) ? value.headers : {}
  return {
    uploadUrl,
    objectKey,
    method: String(value.method ?? 'POST').toUpperCase() === 'PUT' ? 'PUT' : 'POST',
    expiresIn: Math.max(1, asNumber(value.expires_in ?? value.expiresIn, 900)),
    fields: Object.fromEntries(Object.entries(isRecord(value.fields) ? value.fields : {}).map(([key, item]) => [key, String(item)])),
    headers: Object.fromEntries(Object.entries(rawHeaders).map(([key, item]) => [key, String(item)])),
  }
}

function deterministicAssessment(request: SatelliteAssessmentRequest): SatelliteAssessment {
  const checksum = [...request.locationId].reduce((total, char) => total + char.charCodeAt(0), 0)
  const fireRisk = 68 + (checksum % 20)
  const earthquakeRisk = 54 + (checksum % 27)
  const combinedRisk = Math.round(fireRisk * .58 + earthquakeRisk * .42)
  return {
    id: `preview-${request.locationId}-${checksum}`,
    locationId: request.locationId,
    status: 'complete',
    fireRisk,
    earthquakeRisk,
    combinedRisk,
    confidence: 74,
    summary: 'Deterministic local preview from the bundled terrain tile. No model or cloud service was contacted.',
    observations: ['Dry vegetation proxy visible', 'Steep terrain may accelerate spread', 'Seismic exposure retained from the demo baseline'],
    provider: 'Local deterministic preview',
    createdAt: new Date().toISOString(),
    runtime: offlineRuntime,
    persisted: false,
  }
}

function normalizeAssessment(value: unknown, runtime: RuntimeContext): SatelliteAssessment {
  const assessment = isRecord(value) && isRecord(value.assessment) ? value.assessment : value
  if (!isRecord(assessment)) throw new SentinelApiError('Assessment response is invalid')
  const scores = isRecord(assessment.risk_scores) ? assessment.risk_scores : isRecord(assessment.scores) ? assessment.scores : {}
  const observations = Array.isArray(assessment.observations)
    ? assessment.observations.map(String).slice(0, 6)
    : []
  const source = isRecord(assessment.source) ? assessment.source : {}
  const features = isRecord(assessment.features) ? assessment.features : {}
  return {
    id: String(assessment.id ?? `assessment-${Date.now()}`),
    locationId: String(assessment.location_id ?? assessment.locationId ?? ''),
    status: 'complete',
    fireRisk: asPercent(assessment.fire_risk ?? scores.fire ?? scores.fire_risk, 0),
    earthquakeRisk: asPercent(assessment.earthquake_risk ?? scores.earthquake ?? scores.earthquake_risk, 0),
    combinedRisk: asPercent(assessment.combined_risk ?? scores.combined ?? scores.combined_risk, 0),
    confidence: asPercent(assessment.confidence, 0),
    summary: String(assessment.summary ?? assessment.analysis ?? 'Satellite risk assessment completed.'),
    observations,
    provider: String(assessment.provider ?? assessment.model_provider ?? (runtime.persistence === 'cockroachdb' ? 'Configured AWS assessor' : 'Deterministic demo assessor')),
    objectKey: assessment.object_key ? String(assessment.object_key) : assessment.s3_key ? String(assessment.s3_key) : source.object_key ? String(source.object_key) : undefined,
    features: {
      terrain: String(features.terrain ?? 'unknown terrain'),
      vegetationDensity: asNumber(features.vegetation_density),
      moisturePercent: asNumber(features.moisture_percent),
      slopeDegrees: asNumber(features.slope_degrees),
    },
    source,
    createdAt: String(assessment.created_at ?? assessment.createdAt ?? new Date().toISOString()),
    runtime,
    persisted: runtime.persistence === 'cockroachdb' && assessment.persisted === true,
  }
}

async function requestEnvelope<T>(path: string, init?: RequestInit, timeoutMs = 2500): Promise<{ data: T; meta?: ApiMeta }> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    if (!apiConfiguration.valid) {
      throw new SentinelApiError(apiConfiguration.error ?? 'The API origin is not configured safely.', undefined, 'contract')
    }
    const accessToken = cognitoAuth.getAccessToken()
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init?.headers },
      signal: controller.signal,
    })
    if (!response.ok) {
      let message = `API request failed (${response.status})`
      try {
        const errorBody = await response.json() as unknown
        const error = isEnvelope<unknown>(errorBody) ? errorBody.data : errorBody
        if (isRecord(error) && isRecord(error.error) && error.error.message) message = String(error.error.message)
      } catch { /* The status code remains actionable when the body is not JSON. */ }
      throw new SentinelApiError(message, response.status, 'http')
    }
    let body: unknown
    try {
      body = await response.json() as unknown
    } catch {
      throw new SentinelApiError('The SentinelTwin API returned invalid JSON', response.status, 'contract')
    }
    if (isEnvelope<T>(body)) return { data: body.data, meta: body.meta }
    return { data: body as T }
  } catch (error) {
    if (error instanceof SentinelApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw new SentinelApiError('The SentinelTwin API timed out', undefined, 'timeout')
    if (error instanceof TypeError) throw new SentinelApiError('The SentinelTwin API is unreachable', undefined, 'network')
    throw new SentinelApiError('The SentinelTwin API request failed before a response was received', undefined, 'contract')
  } finally {
    window.clearTimeout(timeout)
  }
}

function assessmentObjectKey(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const source = isRecord(value.source) ? value.source : {}
  const key = value.object_key ?? value.s3_key ?? source.object_key
  return key == null ? undefined : String(key)
}

async function pollForAssessment(objectKey: string, timeoutMs = 180_000): Promise<SatelliteAssessment> {
  const deadline = Date.now() + timeoutMs
  do {
    const response = await requestEnvelope<unknown>(`/api/assessments?object_key=${encodeURIComponent(objectKey)}`, undefined, 8_000)
    const payload = isRecord(response.data) ? response.data : {}
    const echoedObjectKey = payload.object_key == null ? '' : String(payload.object_key)
    if (echoedObjectKey && echoedObjectKey !== objectKey) {
      throw new SentinelApiError('The assessment lookup returned a different S3 object key.', undefined, 'contract')
    }
    if (isRecord(payload.assessment)) {
      const normalized = normalizeAssessment(payload.assessment, runtimeFrom(response.meta, response.data))
      if (normalized.objectKey && normalized.objectKey !== objectKey) {
        throw new SentinelApiError('The completed assessment belongs to a different S3 object key.', undefined, 'contract')
      }
      return {
        ...normalized,
        objectKey,
        ...(payload.ingestion_authority == null ? {} : { ingestionAuthority: String(payload.ingestion_authority) }),
      }
    }
    // Retain compatibility with an older list response without issuing a second model request.
    const assessments = Array.isArray(payload.assessments) ? payload.assessments : []
    const match = assessments.find((assessment) => assessmentObjectKey(assessment) === objectKey)
    if (match) {
      const normalized = normalizeAssessment(match, runtimeFrom(response.meta, response.data))
      return {
        ...normalized,
        objectKey,
        ...(payload.ingestion_authority == null ? {} : { ingestionAuthority: String(payload.ingestion_authority) }),
      }
    }
    const status = String(payload.status ?? 'pending').toLowerCase()
    if (status === 'rejected') {
      const scanStatus = String(payload.malware_scan_status ?? 'REJECTED')
      throw new SentinelApiError(`Amazon GuardDuty rejected the quarantined imagery (${scanStatus}).`, 422, 'http')
    }
    if (!['pending', 'processing'].includes(status)) {
      throw new SentinelApiError(`Assessment processing returned unexpected status "${status}".`, undefined, 'contract')
    }
    if (Date.now() >= deadline) break
    await new Promise((resolve) => window.setTimeout(resolve, 1_500))
  } while (Date.now() < deadline)
  throw new SentinelApiError('Source verification or assessment was not complete within 3 minutes.', undefined, 'processing-timeout')
}

export const sentinelApi = {
  async getDashboard(): Promise<{ data: DashboardData; runtime: RuntimeContext; error?: SentinelApiError }> {
    try {
      // A cold Lambda + CockroachDB topology read can legitimately take longer
      // than the lightweight request default. Keep the dashboard honest instead
      // of declaring a healthy persistent API offline during warm-up.
      const response = await requestEnvelope<unknown>('/api/dashboard', undefined, 12_000)
      const runtime = runtimeFrom(response.meta, response.data)
      const data = normalizeDashboard(response.data, runtime)
      if (!data) throw new SentinelApiError('The dashboard response did not match the expected contract.', undefined, 'contract')
      return { data: applyRuntimeTruth(data, runtime), runtime }
    } catch (error) {
      return {
        data: applyRuntimeTruth(structuredClone(demoDashboard), offlineRuntime),
        runtime: offlineRuntime,
        ...(isNetworkUnavailable(error) ? {} : { error: error instanceof SentinelApiError ? error : new SentinelApiError('Dashboard hydration failed') }),
      }
    }
  },

  async runSimulation(payload: SimulationRequest): Promise<SimulationResult> {
    try {
      const agricultural = payload.hazard === 'agricultural_resilience'
      if (agricultural && !payload.assessmentId?.trim()) {
        throw new SentinelApiError('A persisted Sentinel-2 assessment is required for agricultural resilience.')
      }
      const requestBody = agricultural ? {
        location_id: payload.locationId,
        hazard: 'agricultural_resilience',
        assessment_id: payload.assessmentId,
        parameters: {
          rainfall_deficit_percent: payload.rainfallDeficitPercent ?? 35,
          heat_anomaly_c: payload.heatAnomalyC ?? 2,
          irrigation_coverage: payload.irrigationCoverage ?? .4,
          duration_hours: payload.horizonHours,
          use_memory: payload.useMemory,
        },
      } : {
        location_id: payload.locationId,
        hazard: payload.hazard === 'composite' ? 'multi_hazard' : payload.hazard === 'seismic' ? 'earthquake' : 'fire',
        parameters: {
          intensity: payload.intensity / 100,
          duration_hours: payload.horizonHours,
          cascading_impacts: payload.cascadingImpacts,
          use_memory: payload.useMemory,
        },
      }
      const response = await requestEnvelope<unknown>('/api/simulations', { method: 'POST', body: JSON.stringify(requestBody) }, 25_000)
      return normalizeSimulation(response.data, runtimeFrom(response.meta, response.data))
    } catch (error) {
      if (!isNetworkUnavailable(error)) throw error
      if (payload.hazard === 'agricultural_resilience') throw error
      await new Promise((resolve) => window.setTimeout(resolve, 850))
      return { ...demoSimulationResult, runId: `sim-preview-${String(Date.now()).slice(-4)}` }
    }
  },

  async simulateOutage(region = 'us-west-2'): Promise<OutageResult> {
    try {
      const targetRegion = region === 'us-west-2' ? 'us-east-1' : 'us-west-2'
      const response = await requestEnvelope<unknown>('/api/resilience/failover', {
        method: 'POST',
        body: JSON.stringify({ target_region: targetRegion, reason: `regional continuity test: ${region} unavailable` }),
      }, 8_000)
      return normalizeOutage(response.data, region, runtimeFrom(response.meta, response.data))
    } catch (error) {
      if (!isNetworkUnavailable(error)) throw error
      await new Promise((resolve) => window.setTimeout(resolve, 650))
      return { ...demoOutageResult, requestedRegion: region }
    }
  },

  async assessSatellite(request: SatelliteAssessmentRequest, onStage?: (stage: SatelliteAssessmentStage) => void): Promise<SatelliteAssessment> {
    try {
      let objectKey: string | undefined
      if (request.sentinelSourceKey) {
        onStage?.('importing')
        const importResponse = await requestEnvelope<unknown>('/api/satellite/imports', {
          method: 'POST',
          body: JSON.stringify({
            location_id: request.locationId,
            source_key: request.sentinelSourceKey,
          }),
        }, 30_000)
        const imported = isRecord(importResponse.data) ? importResponse.data : {}
        objectKey = imported.object_key == null ? undefined : String(imported.object_key)
        const importStatus = String(imported.status ?? '')
        if (!objectKey || !['quarantine_pending_scan', 'trusted_source_assessed'].includes(importStatus)) {
          throw new SentinelApiError('Sentinel-2 import did not return verified ingestion evidence.', undefined, 'contract')
        }
        if (importStatus === 'trusted_source_assessed') {
          onStage?.('verifying')
          onStage?.('assessing')
        } else {
          onStage?.('scanning')
        }
      } else if (request.file) {
        onStage?.('authorizing')
        const ticketResponse = await requestEnvelope<unknown>('/api/uploads', {
          method: 'POST',
          body: JSON.stringify({
            filename: request.file.name,
            content_type: request.file.type,
            size_bytes: request.file.size,
            location_id: request.locationId,
          }),
        }, 8_000)
        const ticket = normalizeUploadTicket(ticketResponse.data)
        onStage?.('uploading')
        let uploadResponse: Response
        try {
          if (ticket.method === 'POST') {
            const form = new FormData()
            for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value)
            form.append('file', request.file)
            uploadResponse = await fetch(ticket.uploadUrl, { method: 'POST', body: form })
          } else {
            uploadResponse = await fetch(ticket.uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': request.file.type, ...ticket.headers },
              body: request.file,
            })
          }
        } catch (error) {
          if (error instanceof TypeError) throw new SentinelApiError('Amazon S3 is unreachable', undefined, 'network')
          throw error
        }
        if (!uploadResponse.ok) throw new SentinelApiError('Amazon S3 rejected the upload', uploadResponse.status, 'http')
        objectKey = ticket.objectKey
        onStage?.('scanning')
      }

      if (objectKey) return pollForAssessment(objectKey)
      onStage?.('assessing')
      const response = await requestEnvelope<unknown>('/api/assessments', {
        method: 'POST',
        body: JSON.stringify({ location_id: request.locationId, demo_tile: request.demoTile ?? 'california-terrain' }),
      }, 45_000)
      return normalizeAssessment(response.data, runtimeFrom(response.meta, response.data))
    } catch (error) {
      if (!request.file && request.demoTile && isNetworkUnavailable(error)) return deterministicAssessment(request)
      throw error
    }
  },
}

export const apiRuntime = {
  baseUrl: API_BASE,
  configurationError: apiConfiguration.error ?? null,
}

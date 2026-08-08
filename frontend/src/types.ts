export type HazardLayer = 'composite' | 'fire' | 'seismic'
export type RiskLevel = 'high' | 'elevated' | 'moderate'
export type OutageState = 'idle' | 'running' | 'complete'
export type RuntimeSource = 'cockroachdb' | 'api-demo' | 'offline-snapshot'
export type PersistenceMode = 'cockroachdb' | 'ephemeral' | 'none'

export interface RuntimeContext {
  source: RuntimeSource
  apiConnected: boolean
  persistence: PersistenceMode
  memoryProvider: string
  label: string
  detail: string
}

export interface LocationRisk {
  id: string
  name: string
  county: string
  risk: RiskLevel
  hazards: HazardLayer[]
  impactWindow: string
  fireScore: number
  seismicScore: number
  x: number
  y: number
}

export interface MemoryEvent {
  id: string
  title: string
  detail: string
  location: string
  similarity: number
  source: string
}

export interface AgentActivity {
  id: string
  time: string
  agent: string
  action: string
  detail: string
  status: 'working' | 'complete'
}

export interface TimelineEvent {
  id: string
  time: string
  title: string
  detail: string
  status: 'complete' | 'active'
}

export interface PlanMetric {
  label: string
  before: string
  after: string
  delta?: string
}

export interface RegionNode {
  id: string
  region: string
  locality: string
  status: 'healthy' | 'failed' | 'standby'
}

export interface ResilienceEvidence {
  topologyVerified: boolean
  survivalGoal: string | null
  topologySource: string
  configuredRpoSeconds: number | null
  observedRpoSeconds: number | null
}

export interface DashboardData {
  locations: LocationRisk[]
  memory: MemoryEvent
  activities: AgentActivity[]
  timeline: TimelineEvent[]
  planMetrics: PlanMetric[]
  regions: RegionNode[]
  resilience: ResilienceEvidence
  resources: Array<{ label: string; value: number }>
  updatedAt: string
}

export interface SimulationRequest {
  locationId: string
  hazard: HazardLayer
  intensity: number
  horizonHours: number
  cascadingImpacts: string[]
  useMemory: boolean
}

export interface SimulationResult {
  runId: string
  status: 'complete'
  planVersion: string
  confidence: number
  retrievedMemories: number
  recalledMemoryIds: string[]
  learnedMemoryId: string | null
  learningLoop: string
  planProvider: string
  recommendations: string[]
  runtime: RuntimeContext
  persisted: boolean
}

export interface OutageResult {
  requestedRegion: string
  fromRegion: string
  logicalActiveRegion: string
  activeRegionScope: string
  rehearsalOnly: boolean
  actualRegionFailoverPerformed: boolean
  topologyVerified: boolean
  survivalGoal: string | null
  regions: RegionNode[]
  configuredRpoSeconds: number | null
  observedRpoSeconds: number | null
  memoryTransactionVerified: boolean
  memoryCheckScope: string
  memoryCheckDurable: boolean
  notice: string
  runtime: RuntimeContext
}

export interface SatelliteUploadTicket {
  uploadUrl: string
  objectKey: string
  method: 'POST' | 'PUT'
  expiresIn: number
  fields: Record<string, string>
  headers: Record<string, string>
}

export interface SatelliteAssessmentRequest {
  locationId: string
  file?: File
  demoTile?: string
  sentinelSourceKey?: string
}

export type SatelliteAssessmentStage = 'authorizing' | 'uploading' | 'importing' | 'scanning' | 'assessing'

export interface SatelliteAssessment {
  id: string
  locationId: string
  status: 'complete'
  fireRisk: number
  earthquakeRisk: number
  combinedRisk: number
  confidence: number
  summary: string
  observations: string[]
  provider: string
  objectKey?: string
  ingestionAuthority?: string
  createdAt: string
  runtime: RuntimeContext
  persisted: boolean
}

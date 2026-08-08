import type { DashboardData, OutageResult, RuntimeContext, SimulationResult } from '../types'

export const offlineRuntime: RuntimeContext = {
  source: 'offline-snapshot',
  apiConnected: false,
  persistence: 'none',
  memoryProvider: 'bundled deterministic snapshot',
  label: 'Offline snapshot',
  detail: 'Static demonstration data; changes are not persisted',
}

export const demoDashboard: DashboardData = {
  updatedAt: '14:22:46 PT',
  locations: [
    { id: 'santa-rosa', name: 'Santa Rosa', county: 'Sonoma County, CA', risk: 'high', hazards: ['fire', 'seismic'], impactWindow: '6–24 hrs', fireScore: 92, seismicScore: 68, x: 30, y: 29 },
    { id: 'san-bernardino', name: 'San Bernardino', county: 'San Bernardino County, CA', risk: 'high', hazards: ['fire', 'seismic'], impactWindow: '12–36 hrs', fireScore: 87, seismicScore: 82, x: 72, y: 73 },
    { id: 'ridgecrest', name: 'Ridgecrest', county: 'Kern County, CA', risk: 'elevated', hazards: ['seismic'], impactWindow: '24–48 hrs', fireScore: 41, seismicScore: 91, x: 64, y: 55 },
    { id: 'sacramento', name: 'Sacramento', county: 'Sacramento County, CA', risk: 'moderate', hazards: ['fire'], impactWindow: '24–72 hrs', fireScore: 63, seismicScore: 37, x: 45, y: 35 },
  ],
  memory: {
    id: 'mem-2017-nuns',
    title: '2017 Nuns Fire & M5.0 South Napa EQ',
    detail: 'Wind-driven fire with concurrent seismic infrastructure damage.',
    location: 'Sonoma County, CA',
    similarity: 0.86,
    source: 'Curated deterministic demo memory',
  },
  activities: [
    { id: 'a1', time: '14:20', agent: 'Risk Assessor', action: 'Replaying bundled feeds', detail: 'Deterministic weather, seismic, traffic', status: 'complete' },
    { id: 'a2', time: '14:20', agent: 'Similarity Retriever', action: 'Memory retrieval', detail: 'Found 12 similar events', status: 'complete' },
    { id: 'a3', time: '14:21', agent: 'Scenario Builder', action: 'Compound scenario', detail: 'Fire + earthquake cascade', status: 'complete' },
    { id: 'a4', time: '14:21', agent: 'Resource Planner', action: 'Drafting resource plan', detail: 'Optimizing staging areas', status: 'complete' },
    { id: 'a5', time: '14:22', agent: 'Commander', action: 'Demo plan validated', detail: 'Ready for review · not execution', status: 'complete' },
  ],
  timeline: [
    { id: 't1', time: '14:22', title: 'Scenario defined', detail: 'Santa Rosa · Fire + Earthquake', status: 'complete' },
    { id: 't2', time: '14:22', title: 'Memory retrieved', detail: '2017 Nuns Fire & M5.0 South Napa EQ', status: 'complete' },
    { id: 't3', time: '14:22', title: 'Simulation run', detail: 'Wind shift, M6.1 earthquake', status: 'complete' },
    { id: 't4', time: '14:22', title: 'Resource plan generated', detail: '48 resources · 5 staging areas', status: 'complete' },
    { id: 't5', time: '14:22', title: 'Outcome replayed', detail: 'Bundled demo snapshot · no database write', status: 'complete' },
  ],
  planMetrics: [
    { label: 'Estimated structures at risk', before: '12,450', after: '6,230', delta: '↓ 50%' },
    { label: 'Expected casualties', before: '98–142', after: '32–48', delta: '↓ 63%' },
    { label: 'Critical facilities impact', before: 'High', after: 'Moderate' },
    { label: 'Plan confidence', before: '57%', after: '86%', delta: '+29 pts' },
  ],
  regions: [
    { id: 'west', region: 'us-west-2', locality: 'Oregon', status: 'healthy' },
    { id: 'east', region: 'us-east-1', locality: 'N. Virginia', status: 'healthy' },
    { id: 'eu', region: 'eu-central-1', locality: 'Frankfurt', status: 'healthy' },
  ],
  resilience: {
    topologyVerified: false,
    survivalGoal: null,
    topologySource: 'bundled illustrative topology',
    configuredRpoSeconds: null,
    observedRpoSeconds: null,
  },
  resources: [
    { label: 'Type 1 IMT', value: 1 }, { label: 'Engine crews', value: 18 },
    { label: 'Hand crews', value: 8 }, { label: 'Dozers', value: 4 },
    { label: 'Water tenders', value: 6 }, { label: 'Helicopters', value: 3 },
    { label: 'Medical units', value: 4 }, { label: 'Shelter sites', value: 5 },
  ],
}

export const demoSimulationResult: SimulationResult = {
  runId: 'sim-st-2048', status: 'complete', planVersion: 'v7.3', confidence: 86, retrievedMemories: 12,
  recalledMemoryIds: ['demo-memory-camp-fire', 'demo-memory-northridge'],
  learnedMemoryId: null,
  learningLoop: 'local deterministic preview · no learned memory write',
  planProvider: 'local-deterministic-preview',
  recommendations: [
    'Stage resources before the modeled impact window',
    'Keep redundant evacuation corridors available',
    'Require incident-command review before operational use',
  ],
  runtime: offlineRuntime,
  persisted: false,
}

export const demoOutageResult: OutageResult = {
  requestedRegion: 'us-west-2',
  fromRegion: 'us-west-2',
  logicalActiveRegion: 'us-east-1',
  activeRegionScope: 'local-preview-routing-label',
  rehearsalOnly: true,
  actualRegionFailoverPerformed: false,
  topologyVerified: false,
  survivalGoal: null,
  regions: [],
  configuredRpoSeconds: null,
  observedRpoSeconds: null,
  memoryTransactionVerified: false,
  memoryCheckScope: 'local deterministic preview only',
  memoryCheckDurable: false,
  notice: 'Offline preview only; no infrastructure, database topology, or regional failure was exercised.',
  runtime: offlineRuntime,
}

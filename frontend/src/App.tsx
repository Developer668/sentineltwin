import { useCallback, useEffect, useMemo, useState } from 'react'
import { Header } from './components/Header'
import { MemoryRail } from './components/MemoryRail'
import { OutcomePanel } from './components/OutcomePanel'
import { RiskMap } from './components/RiskMap'
import { RiskWatchlist } from './components/RiskWatchlist'
import { SatelliteAssessmentModal } from './components/SatelliteAssessmentModal'
import { Sidebar } from './components/Sidebar'
import { SimulationModal } from './components/SimulationModal'
import { SystemWorkspace } from './components/SystemWorkspace'
import { Toast } from './components/Toast'
import { demoDashboard, offlineRuntime } from './data/demoData'
import { describeApiError, sentinelApi } from './lib/api'
import { cognitoAuth } from './lib/auth'
import type { DashboardData, HazardLayer, OutageResult, OutageState, SatelliteAssessment, SatelliteAssessmentRequest, SatelliteAssessmentStage, SimulationRequest, SimulationResult, WorkspaceId } from './types'

const workspaceLabels: Record<WorkspaceId, string> = {
  operations: 'Operations',
  awareness: 'Situational Awareness',
  incidents: 'Incidents',
  resources: 'Resources',
  plans: 'Plans',
  simulations: 'Simulations',
  agents: 'Agents',
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData>(() => structuredClone(demoDashboard))
  const [runtime, setRuntime] = useState(offlineRuntime)
  const [auth, setAuth] = useState(() => cognitoAuth.state())
  const [selectedLocationId, setSelectedLocationId] = useState('santa-rosa')
  const [layer, setLayer] = useState<HazardLayer>('composite')
  const [simulationOpen, setSimulationOpen] = useState(false)
  const [assessmentOpen, setAssessmentOpen] = useState(false)
  const [outageState, setOutageState] = useState<OutageState>('idle')
  const [outageResult, setOutageResult] = useState<OutageResult | null>(null)
  const [outageError, setOutageError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(() => new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }).format(new Date()))
  const [planVersion, setPlanVersion] = useState('v7.3')
  const [toast, setToast] = useState<string | null>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('operations')

  useEffect(() => {
    let active = true
    const hydrate = async () => {
      const nextAuth = await cognitoAuth.completeCallback()
      if (!active) return
      setAuth(nextAuth)
      if (nextAuth.error) setToast(nextAuth.error)
      const { data, runtime: nextRuntime, error } = await sentinelApi.getDashboard()
      if (!active) return
      setDashboard(data)
      setRuntime(nextRuntime)
      if (error) setToast(describeApiError(error, 'load the command center'))
      if (data.locations.length && !data.locations.some((location) => location.id === selectedLocationId)) setSelectedLocationId(data.locations[0].id)
    }
    void hydrate()
    return () => { active = false }
  }, []) // Backend hydration should occur once; interactions remain optimistic.

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentTime(new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }).format(new Date()))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const selectedLocation = useMemo(
    () => dashboard.locations.find((location) => location.id === selectedLocationId) ?? dashboard.locations[0] ?? demoDashboard.locations[0],
    [dashboard.locations, selectedLocationId],
  )

  const runSimulation = useCallback(async (request: SimulationRequest) => sentinelApi.runSimulation(request), [])

  const completeSimulation = useCallback((result: SimulationResult) => {
    setPlanVersion(result.planVersion)
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    setDashboard((current) => ({
      ...current,
      timeline: [
        {
          id: `t-${result.runId}`,
          time: now,
          title: result.persisted
            ? 'Learned outcome persisted'
            : result.runtime.source === 'api-demo' ? 'Demo outcome generated' : result.runtime.apiConnected ? 'Outcome returned without commit evidence' : 'Local preview generated',
          detail: `${result.runId} · ${result.planProvider} · ${result.retrievedMemories} memories · ${result.persisted ? `learned ${result.learnedMemoryId}` : result.runtime.persistence === 'ephemeral' ? 'ephemeral' : 'not persisted'}`,
          status: 'complete',
        },
        ...current.timeline.slice(0, 4),
      ],
      activities: [
        { id: `a-${result.runId}`, time: now, agent: 'Commander', action: 'Plan validated', detail: `${result.planProvider} · ${result.confidence}% · ${result.persisted ? 'durable learned memory' : 'preview only'}`, status: 'complete' },
        ...current.activities.slice(0, 4),
      ],
    }))
    setToast(result.persisted
      ? `${result.planProvider} plan ${result.planVersion} and learned memory ${result.learnedMemoryId} persisted to CockroachDB`
      : result.runtime.source === 'api-demo'
        ? `Plan ${result.planVersion} completed in ephemeral demo state`
        : result.runtime.apiConnected
          ? `${result.planProvider} returned plan ${result.planVersion}, but no learned-memory commit evidence was included`
        : `Plan ${result.planVersion} generated locally; nothing was persisted`)
  }, [])

  const simulateOutage = useCallback(async () => {
    if (outageState !== 'idle') return
    setOutageState('running')
    setOutageError(null)
    try {
      const result = await sentinelApi.simulateOutage('us-west-2')
      setOutageResult(result)
      setOutageState('complete')
      const durableTransactionRead = result.memoryTransactionVerified && result.memoryCheckDurable && result.runtime.persistence === 'cockroachdb'
      setToast(result.actualRegionFailoverPerformed && result.topologyVerified
        ? `Observed regional failover evidence received${result.observedRpoSeconds == null ? '; observed RPO was not reported' : `; observed RPO ${result.observedRpoSeconds}s`}`
        : durableTransactionRead
          ? 'Logical routing rehearsal complete; durable same-transaction read-after-write verified. No region failed.'
          : result.memoryTransactionVerified
            ? 'Logical routing rehearsal complete; a transient transaction read was verified, but durable continuity was not established'
            : 'Routing-label rehearsal complete; no regional failover or durable memory verification was performed')
    } catch (error) {
      setOutageResult(null)
      setOutageState('idle')
      setOutageError(describeApiError(error, 'run the routing continuity rehearsal'))
    }
  }, [outageState])

  const restoreRegion = useCallback(() => {
    setOutageState('idle')
    setOutageResult(null)
    setOutageError(null)
    setToast('Rehearsal evidence cleared from the view; no infrastructure failover or recovery action was performed')
  }, [])

  const assessSatellite = useCallback(
    (request: SatelliteAssessmentRequest, onStage: (stage: SatelliteAssessmentStage) => void) => sentinelApi.assessSatellite(request, onStage),
    [],
  )

  const completeAssessment = useCallback((assessment: SatelliteAssessment) => {
    const risk = assessment.combinedRisk >= 78 ? 'high' : assessment.combinedRisk >= 62 ? 'elevated' : 'moderate'
    const hazards: HazardLayer[] = assessment.fireRisk >= 65 && assessment.earthquakeRisk >= 65
      ? ['fire', 'seismic']
      : assessment.fireRisk >= assessment.earthquakeRisk ? ['fire'] : ['seismic']
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    setDashboard((current) => ({
      ...current,
      locations: current.locations.map((location) => location.id === assessment.locationId
        ? { ...location, fireScore: assessment.fireRisk, seismicScore: assessment.earthquakeRisk, risk, hazards }
        : location),
      timeline: [
        {
          id: `t-${assessment.id}`,
          time: now,
          title: 'Satellite risk assessed',
          detail: `${assessment.provider} · ${assessment.persisted ? 'persisted' : 'not persisted'}`,
          status: 'complete',
        },
        ...current.timeline.slice(0, 4),
      ],
      activities: [
        { id: `a-${assessment.id}`, time: now, agent: 'Risk Assessor', action: 'Imagery assessment complete', detail: `${assessment.combinedRisk}% combined risk · ${assessment.confidence}% confidence`, status: 'complete' },
        ...current.activities.slice(0, 4),
      ],
    }))
    setToast(assessment.persisted
      ? `${assessment.provider} assessment and learned memory persisted to CockroachDB`
      : assessment.runtime.source === 'api-demo'
        ? `${assessment.provider} assessment completed in ephemeral API state`
        : assessment.runtime.apiConnected
          ? `${assessment.provider} assessment returned without durable CockroachDB persistence evidence`
        : 'Local deterministic preview complete; nothing was uploaded or persisted')
  }, [])

  const handleAuth = useCallback(() => {
    if (auth.authenticated) {
      cognitoAuth.signOut()
      setAuth(cognitoAuth.state())
      return
    }
    void cognitoAuth.beginSignIn()
  }, [auth.authenticated])

  const showPreviewLimit = useCallback((feature: string) => {
    setToast(`${feature} is represented in this hackathon command-center surface; the core simulation, assessment, and continuity workflows are interactive.`)
  }, [])

  const navigateWorkspace = useCallback((workspace: WorkspaceId) => {
    setActiveWorkspace(workspace)
    window.history.replaceState(null, '', `#${workspace}`)
  }, [])

  const openSimulation = useCallback((hazard?: HazardLayer) => {
    if (hazard) setLayer(hazard)
    setSimulationOpen(true)
  }, [])

  useEffect(() => {
    document.title = `${workspaceLabels[activeWorkspace]} · SentinelTwin`
  }, [activeWorkspace])

  return (
    <div className="app-shell workspace-shell">
      <a className="skip-link" href="#risk-map">Skip to risk map</a>
      <Sidebar runtime={runtime} activeWorkspace={activeWorkspace} onNavigate={navigateWorkspace} onUnavailable={showPreviewLimit} />
      <Header
        runtime={runtime}
        auth={auth}
        workspaceLabel={workspaceLabels[activeWorkspace]}
        currentTime={currentTime}
        updatedAt={dashboard.updatedAt}
        onAssessSatellite={() => setAssessmentOpen(true)}
        onRunSimulation={() => openSimulation()}
        onAuthAction={handleAuth}
        onInfo={showPreviewLimit}
      />

      {activeWorkspace === 'operations' ? (
        <main className="operations-workspace" aria-label="Operations command center">
          <RiskWatchlist locations={dashboard.locations} selectedId={selectedLocation.id} onSelect={setSelectedLocationId} onInfo={showPreviewLimit} />
          <RiskMap layer={layer} onLayerChange={setLayer} locations={dashboard.locations} selected={selectedLocation} onSelect={setSelectedLocationId} runtime={runtime} onInfo={showPreviewLimit} />
          <MemoryRail
            memory={dashboard.memory}
            activities={dashboard.activities}
            regions={dashboard.regions}
            resilience={dashboard.resilience}
            runtime={runtime}
            outageState={outageState}
            outageResult={outageResult}
            outageError={outageError}
            onOutage={simulateOutage}
            onRestore={restoreRegion}
          />
          <OutcomePanel timeline={dashboard.timeline} metrics={dashboard.planMetrics} resources={dashboard.resources} planVersion={planVersion} runtime={runtime} onInfo={showPreviewLimit} />
        </main>
      ) : (
        <SystemWorkspace
          workspace={activeWorkspace}
          dashboard={dashboard}
          runtime={runtime}
          selectedLocation={selectedLocation}
          layer={layer}
          planVersion={planVersion}
          outageState={outageState}
          outageResult={outageResult}
          outageError={outageError}
          onSelectLocation={setSelectedLocationId}
          onLayerChange={setLayer}
          onNavigate={navigateWorkspace}
          onRunSimulation={openSimulation}
          onAssessSatellite={() => setAssessmentOpen(true)}
          onOutage={simulateOutage}
          onRestore={restoreRegion}
          onInfo={showPreviewLimit}
        />
      )}
      <SimulationModal
        open={simulationOpen}
        location={selectedLocation}
        runtime={runtime}
        initialLayer={layer}
        onClose={() => setSimulationOpen(false)}
        onSubmit={runSimulation}
        onComplete={completeSimulation}
      />
      <SatelliteAssessmentModal
        open={assessmentOpen}
        location={selectedLocation}
        runtime={runtime}
        onClose={() => setAssessmentOpen(false)}
        onSubmit={assessSatellite}
        onComplete={completeAssessment}
      />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

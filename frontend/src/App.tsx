import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Play, Satellite } from 'lucide-react'
import { CommandHero } from './components/CommandHero'
import { EvidenceCarousel } from './components/EvidenceCarousel'
import { Header } from './components/Header'
import { MemoryRail } from './components/MemoryRail'
import { OutcomePanel } from './components/OutcomePanel'
import { RiskMap } from './components/RiskMap'
import { RiskWatchlist } from './components/RiskWatchlist'
import { SatelliteAssessmentModal } from './components/SatelliteAssessmentModal'
import { Sidebar } from './components/Sidebar'
import { SimulationModal } from './components/SimulationModal'
import { Toast } from './components/Toast'
import { demoDashboard, offlineRuntime } from './data/demoData'
import { describeApiError, sentinelApi } from './lib/api'
import { cognitoAuth } from './lib/auth'
import type { DashboardData, HazardLayer, OutageResult, OutageState, SatelliteAssessment, SatelliteAssessmentRequest, SatelliteAssessmentStage, SimulationRequest, SimulationResult } from './types'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const learningStatement = 'Every completed scenario should leave the next operator with stronger evidence, clearer limits, and a more defensible plan.'
const learningWords = learningStatement.split(' ')

export default function App() {
  const shellRef = useRef<HTMLDivElement>(null)
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

  useGSAP(() => {
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const words = gsap.utils.toArray<HTMLElement>('.desire-copy .scrub-word')
      gsap.fromTo(words, { opacity: 0.14 }, {
        opacity: 1,
        stagger: 0.055,
        ease: 'none',
        scrollTrigger: {
          trigger: '.desire-copy',
          start: 'top 82%',
          end: 'bottom 40%',
          scrub: 0.7,
        },
      })

      gsap.utils.toArray<HTMLElement>('[data-scroll-image]').forEach((element) => {
        gsap.fromTo(element, { scale: 0.84, opacity: 0.28 }, {
          scale: 1,
          opacity: 1,
          transformOrigin: '50% 50%',
          ease: 'none',
          scrollTrigger: {
            trigger: element,
            start: 'top 92%',
            end: 'center 56%',
            scrub: 0.8,
            invalidateOnRefresh: true,
          },
        })
        gsap.to(element, {
          opacity: 0.22,
          filter: 'brightness(.58) saturate(.72)',
          ease: 'none',
          scrollTrigger: {
            trigger: element,
            start: 'bottom 32%',
            end: 'bottom top',
            scrub: 0.8,
            invalidateOnRefresh: true,
          },
        })
      })
    })
    return () => media.revert()
  }, { scope: shellRef })

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

  return (
    <div ref={shellRef} className="app-shell taste-refresh">
      <a className="skip-link" href="#risk-map">Skip to risk map</a>
      <Sidebar runtime={runtime} onUnavailable={showPreviewLimit} />
      <div className="command-canvas">
        <Header
          runtime={runtime}
          auth={auth}
          currentTime={currentTime}
          updatedAt={dashboard.updatedAt}
          onAssessSatellite={() => setAssessmentOpen(true)}
          onRunSimulation={() => setSimulationOpen(true)}
          onAuthAction={handleAuth}
          onInfo={showPreviewLimit}
        />

        <main className="command-page overflow-x-hidden w-full max-w-full">
          <CommandHero onRunSimulation={() => setSimulationOpen(true)} onAssessSatellite={() => setAssessmentOpen(true)} />

          <section id="regional-picture" className="operations-chapter" aria-labelledby="regional-picture-title">
            <div className="chapter-heading max-w-6xl">
              <h2 id="regional-picture-title">One region. Several failure paths.</h2>
              <p>Explore the live operational picture without losing the provenance, persistence, and human-review limits behind every signal.</p>
            </div>

            <div className="interest-bento grid-flow-dense">
              <RiskWatchlist locations={dashboard.locations} selectedId={selectedLocation.id} onSelect={setSelectedLocationId} onInfo={showPreviewLimit} />
              <RiskMap layer={layer} onLayerChange={setLayer} locations={dashboard.locations} selected={selectedLocation} onSelect={setSelectedLocationId} runtime={runtime} onInfo={showPreviewLimit} />
              <EvidenceCarousel memory={dashboard.memory} activities={dashboard.activities} resilience={dashboard.resilience} runtime={runtime} />
            </div>
          </section>

          <section className="learning-chapter" aria-labelledby="learning-title">
            <div className="chapter-heading desire-heading max-w-6xl">
              <h2 id="learning-title">Operational memory that earns its place.</h2>
              <p className="desire-copy">
                {learningWords.map((word, index) => (
                  <span className="scrub-word" key={`${word}-${index}`}>{word}{index === learningWords.length - 1 ? '' : ' '}</span>
                ))}
              </p>
            </div>

            <div className="desire-bento grid-flow-dense">
              <OutcomePanel timeline={dashboard.timeline} metrics={dashboard.planMetrics} resources={dashboard.resources} planVersion={planVersion} runtime={runtime} onInfo={showPreviewLimit} />
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
            </div>
          </section>

          <footer className="command-action">
            <div>
              <h2>Pressure-test the next decision before conditions choose for you.</h2>
              <p>Run a bounded scenario or bring in source imagery. Every result stays explicit about evidence, persistence, and human review.</p>
            </div>
            <div className="action-buttons">
              <button className="hero-primary" type="button" onClick={() => setSimulationOpen(true)}><Play size={17} fill="currentColor" /> Run simulation</button>
              <button className="hero-secondary" type="button" onClick={() => setAssessmentOpen(true)}><Satellite size={17} /> Assess imagery</button>
            </div>
          </footer>
        </main>
      </div>
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

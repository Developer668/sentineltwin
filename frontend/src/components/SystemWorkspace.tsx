import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Boxes,
  Check,
  Clock3,
  Database,
  FileClock,
  Flame,
  FlaskConical,
  Leaf,
  RadioTower,
  Satellite,
  ShieldCheck,
  Siren,
  Sparkles,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { MemoryRail } from './MemoryRail'
import { OutcomePanel } from './OutcomePanel'
import { RiskMap } from './RiskMap'
import { RiskWatchlist } from './RiskWatchlist'
import type {
  DashboardData,
  HazardLayer,
  LocationRisk,
  OutageResult,
  OutageState,
  RuntimeContext,
  WorkspaceId,
} from '../types'

interface SystemWorkspaceProps {
  workspace: Exclude<WorkspaceId, 'operations'>
  dashboard: DashboardData
  runtime: RuntimeContext
  selectedLocation: LocationRisk
  layer: HazardLayer
  planVersion: string
  outageState: OutageState
  outageResult: OutageResult | null
  outageError: string | null
  onSelectLocation: (id: string) => void
  onLayerChange: (layer: HazardLayer) => void
  onNavigate: (workspace: WorkspaceId) => void
  onRunSimulation: (hazard?: HazardLayer) => void
  onAssessSatellite: () => void
  onOutage: () => void
  onRestore: () => void
  onInfo: (feature: string) => void
}

const workspaceCopy: Record<Exclude<WorkspaceId, 'operations'>, { eyebrow: string; title: string; detail: string }> = {
  awareness: {
    eyebrow: 'Live regional picture',
    title: 'Situational awareness',
    detail: 'Inspect hazard layers, source provenance, and the selected impact window.',
  },
  incidents: {
    eyebrow: 'Four monitored locations',
    title: 'Incident desk',
    detail: 'Triage the current watchlist and move any location into modeling or assessment.',
  },
  resources: {
    eyebrow: '48 assets in draft plan',
    title: 'Resource readiness',
    detail: 'Review modeled availability and open a scenario before changing deployment posture.',
  },
  plans: {
    eyebrow: 'Human review required',
    title: 'Response plans',
    detail: 'Compare memory-assisted outcomes with the current draft resource plan.',
  },
  simulations: {
    eyebrow: 'Bounded decision support',
    title: 'Simulation lab',
    detail: 'Start a fire, seismic, compound, or evidence-bound agricultural scenario for the selected location.',
  },
  agents: {
    eyebrow: 'Shared operational memory',
    title: 'Agent systems',
    detail: 'Inspect role activity, retrieved evidence, persistence, and resilience checks.',
  },
}

const agentRoster = [
  { name: 'Risk Assessor', role: 'Terrain + hazard fusion', icon: Satellite, accent: 'orange' },
  { name: 'Similarity Retriever', role: 'Vector memory recall', icon: Database, accent: 'lime' },
  { name: 'Scenario Builder', role: 'Compound-event modeling', icon: FlaskConical, accent: 'violet' },
  { name: 'Resource Planner', role: 'Staging + allocation', icon: Boxes, accent: 'cyan' },
  { name: 'Incident Commander', role: 'Review + learning loop', icon: ShieldCheck, accent: 'lime' },
] as const

function WorkspaceHeading({ workspace, actions }: { workspace: Exclude<WorkspaceId, 'operations'>; actions?: ReactNode }) {
  const copy = workspaceCopy[workspace]
  return (
    <header className="workspace-heading">
      <div>
        <span>{copy.eyebrow}</span>
        <h1 id={`workspace-${workspace}-title`}>{copy.title}</h1>
        <p>{copy.detail}</p>
      </div>
      {actions && <div className="workspace-actions">{actions}</div>}
    </header>
  )
}

function RuntimeBadge({ runtime }: { runtime: RuntimeContext }) {
  return (
    <span className={`workspace-runtime ${runtime.source}`} title={runtime.detail}>
      <i aria-hidden="true" /> {runtime.persistence === 'cockroachdb' ? 'Durable live data' : runtime.apiConnected ? 'Ephemeral API data' : 'Bundled snapshot'}
    </span>
  )
}

export function SystemWorkspace(props: SystemWorkspaceProps) {
  const {
    workspace,
    dashboard,
    runtime,
    selectedLocation,
    layer,
    planVersion,
    outageState,
    outageResult,
    outageError,
    onSelectLocation,
    onLayerChange,
    onNavigate,
    onRunSimulation,
    onAssessSatellite,
    onOutage,
    onRestore,
    onInfo,
  } = props

  const highRiskCount = dashboard.locations.filter((location) => location.risk === 'high').length
  const totalResources = dashboard.resources.reduce((sum, resource) => sum + resource.value, 0)

  if (workspace === 'awareness') {
    return (
      <main className="workspace-view" aria-labelledby="workspace-awareness-title">
        <WorkspaceHeading
          workspace="awareness"
          actions={<><RuntimeBadge runtime={runtime} /><button className="workspace-button secondary" type="button" onClick={onAssessSatellite}><Satellite size={15} /> Assess imagery</button></>}
        />
        <div className="workspace-kpis" aria-label="Situational awareness summary">
          <span><small>High-risk locations</small><strong>{highRiskCount}</strong><em>of {dashboard.locations.length} monitored</em></span>
          <span><small>Selected impact window</small><strong>{selectedLocation.impactWindow}</strong><em>{selectedLocation.name}</em></span>
          <span><small>Fire signal</small><strong className="orange-value">{selectedLocation.fireScore}%</strong><em>modeled risk score</em></span>
          <span><small>Seismic signal</small><strong className="violet-value">{selectedLocation.seismicScore}%</strong><em>modeled risk score</em></span>
        </div>
        <div className="awareness-grid">
          <RiskWatchlist locations={dashboard.locations} selectedId={selectedLocation.id} onSelect={onSelectLocation} onInfo={onInfo} />
          <RiskMap layer={layer} onLayerChange={onLayerChange} locations={dashboard.locations} selected={selectedLocation} onSelect={onSelectLocation} runtime={runtime} onInfo={onInfo} />
          <section className="workspace-panel signal-panel" aria-label="Selected location briefing">
            <div className="workspace-panel-title"><span>Selected location</span><RadioTower size={15} /></div>
            <div className="selected-incident-title"><strong>{selectedLocation.name}</strong><span>{selectedLocation.county}</span></div>
            <dl className="signal-list">
              <div><dt>Operational risk</dt><dd className={selectedLocation.risk}>{selectedLocation.risk}</dd></div>
              <div><dt>Hazards</dt><dd>{selectedLocation.hazards.join(' + ')}</dd></div>
              <div><dt>Evidence source</dt><dd>{runtime.label}</dd></div>
              <div><dt>Decision status</dt><dd>Human review required</dd></div>
            </dl>
            <button className="workspace-button primary" type="button" onClick={() => onRunSimulation(layer)}>Model selected location <ArrowRight size={15} /></button>
          </section>
        </div>
      </main>
    )
  }

  if (workspace === 'incidents') {
    return (
      <main className="workspace-view" aria-labelledby="workspace-incidents-title">
        <WorkspaceHeading
          workspace="incidents"
          actions={<button className="workspace-button primary" type="button" onClick={onAssessSatellite}><Satellite size={15} /> New imagery assessment</button>}
        />
        <div className="workspace-kpis">
          <span><small>Escalated</small><strong className="orange-value">{highRiskCount}</strong><em>requires review</em></span>
          <span><small>Elevated</small><strong>{dashboard.locations.filter((item) => item.risk === 'elevated').length}</strong><em>active monitoring</em></span>
          <span><small>Compound hazards</small><strong>{dashboard.locations.filter((item) => item.hazards.length > 1).length}</strong><em>fire + seismic</em></span>
          <span><small>Next impact window</small><strong>6 hrs</strong><em>Santa Rosa</em></span>
        </div>
        <section className="workspace-panel incident-desk" aria-label="Incident watchlist table">
          <div className="workspace-panel-title"><span>Regional incident queue</span><Siren size={16} /></div>
          <div className="incident-table" role="table" aria-label="Monitored incidents">
            <div className="incident-table-head" role="row">
              <span role="columnheader">Incident</span><span role="columnheader">Hazards</span><span role="columnheader">Risk</span><span role="columnheader">Impact window</span><span role="columnheader">Action</span>
            </div>
            {dashboard.locations.map((location, index) => (
              <div className={`incident-table-row ${location.id === selectedLocation.id ? 'selected' : ''}`} role="row" key={location.id}>
                <span role="cell"><i>ST-{String(index + 1).padStart(3, '0')}</i><strong>{location.name}</strong><small>{location.county}</small></span>
                <span role="cell" className="hazard-cell">{location.hazards.includes('fire') && <Flame size={14} />}{location.hazards.includes('seismic') && <Activity size={14} />}{location.hazards.join(' + ')}</span>
                <span role="cell"><em className={`incident-risk ${location.risk}`}>{location.risk}</em></span>
                <span role="cell"><Clock3 size={13} /> {location.impactWindow}</span>
                <span role="cell"><button type="button" onClick={() => { onSelectLocation(location.id); onNavigate('awareness') }}>Open picture <ArrowRight size={13} /></button></span>
              </div>
            ))}
          </div>
        </section>
      </main>
    )
  }

  if (workspace === 'resources') {
    return (
      <main className="workspace-view" aria-labelledby="workspace-resources-title">
        <WorkspaceHeading
          workspace="resources"
          actions={<button className="workspace-button primary" type="button" onClick={() => onRunSimulation('composite')}><Sparkles size={15} /> Optimize allocation</button>}
        />
        <div className="workspace-kpis">
          <span><small>Assets in draft</small><strong>{totalResources}</strong><em>across 8 categories</em></span>
          <span><small>Staging areas</small><strong>5</strong><em>modeled locations</em></span>
          <span><small>Selected region</small><strong>{selectedLocation.name}</strong><em>{selectedLocation.impactWindow}</em></span>
          <span><small>Plan status</small><strong>Draft</strong><em>human approval pending</em></span>
        </div>
        <div className="resource-dashboard">
          <section className="workspace-panel resource-inventory">
            <div className="workspace-panel-title"><span>Modeled inventory</span><Boxes size={16} /></div>
            <div className="resource-table">
              {dashboard.resources.map((resource) => {
                const staged = Math.max(1, Math.round(resource.value * .62))
                return (
                  <div key={resource.label}>
                    <span><strong>{resource.label}</strong><small>{staged} staged · {resource.value - staged} reserve</small></span>
                    <i><b style={{ width: `${Math.round((staged / resource.value) * 100)}%` }} /></i>
                    <em>{resource.value}</em>
                  </div>
                )
              })}
            </div>
          </section>
          <section className="workspace-panel allocation-panel">
            <div className="workspace-panel-title"><span>Allocation guardrails</span><ShieldCheck size={16} /></div>
            <ul className="guardrail-list">
              <li><Check size={14} /><span><strong>Redundant corridors</strong><small>Keep evacuation coverage on both sides of modeled disruption.</small></span></li>
              <li><Check size={14} /><span><strong>Reserve threshold</strong><small>Maintain 30% reserve until incident-command approval.</small></span></li>
              <li><AlertTriangle size={14} /><span><strong>Decision boundary</strong><small>Draft allocations are decision support, not dispatch orders.</small></span></li>
            </ul>
            <button className="workspace-button secondary" type="button" onClick={() => onNavigate('plans')}>Review response plan <ArrowRight size={15} /></button>
          </section>
        </div>
      </main>
    )
  }

  if (workspace === 'plans') {
    return (
      <main className="workspace-view" aria-labelledby="workspace-plans-title">
        <WorkspaceHeading
          workspace="plans"
          actions={<><span className="plan-version-badge">Plan {planVersion}</span><button className="workspace-button primary" type="button" onClick={() => onRunSimulation('composite')}><FlaskConical size={15} /> Generate revision</button></>}
        />
        <div className="plan-workspace-grid">
          <OutcomePanel timeline={dashboard.timeline} metrics={dashboard.planMetrics} resources={dashboard.resources} planVersion={planVersion} runtime={runtime} onInfo={onInfo} />
          <section className="workspace-panel approval-panel">
            <div className="workspace-panel-title"><span>Approval chain</span><FileClock size={16} /></div>
            <ol>
              <li className="complete"><Check size={13} /><span><strong>Evidence assembled</strong><small>Risk + memory sources attached</small></span></li>
              <li className="complete"><Check size={13} /><span><strong>Scenario modeled</strong><small>Compound impacts bounded</small></span></li>
              <li className="active"><Users size={13} /><span><strong>Incident review</strong><small>Human validation required</small></span></li>
              <li><ShieldCheck size={13} /><span><strong>Operational release</strong><small>No automated dispatch</small></span></li>
            </ol>
            <div className="approval-note"><AlertTriangle size={15} /><span><strong>Draft only</strong><small>Recommendations must be validated against current field intelligence.</small></span></div>
          </section>
        </div>
      </main>
    )
  }

  if (workspace === 'simulations') {
    const presets: Array<{ hazard: HazardLayer; title: string; detail: string; icon: typeof Flame; tone: string }> = [
      { hazard: 'fire', title: 'Wind-driven fire', detail: 'Model rapid spread and evacuation pressure.', icon: Flame, tone: 'orange' },
      { hazard: 'seismic', title: 'Major fault rupture', detail: 'Model access loss and facility impact.', icon: Activity, tone: 'violet' },
      { hazard: 'composite', title: 'Compound cascade', detail: 'Combine fire, seismic, and infrastructure stress.', icon: FlaskConical, tone: 'lime' },
      { hazard: 'agricultural_resilience', title: 'Agricultural resilience', detail: 'Model crop stress from persisted Sentinel-2 evidence.', icon: Leaf, tone: 'cyan' },
    ]
    return (
      <main className="workspace-view" aria-labelledby="workspace-simulations-title">
        <WorkspaceHeading workspace="simulations" actions={<RuntimeBadge runtime={runtime} />} />
        <div className="simulation-presets">
          {presets.map(({ hazard, title, detail, icon: Icon, tone }) => (
            <button type="button" className={`simulation-preset ${tone}`} key={hazard} onClick={() => onRunSimulation(hazard)}>
              <span><Icon size={20} /></span><strong>{title}</strong><small>{detail}</small><em>Configure scenario <ArrowRight size={14} /></em>
            </button>
          ))}
        </div>
        <section className="workspace-panel simulation-history">
          <div className="workspace-panel-title"><span>Recent simulation activity</span><FlaskConical size={16} /></div>
          <ol>
            {dashboard.timeline.map((event, index) => (
              <li key={event.id}><time>{event.time}</time><i className={index === 0 ? 'active' : ''} /><span><strong>{event.title}</strong><small>{event.detail}</small></span><em>{event.status}</em></li>
            ))}
          </ol>
        </section>
      </main>
    )
  }

  return (
    <main className="workspace-view" aria-labelledby="workspace-agents-title">
      <WorkspaceHeading workspace="agents" actions={<RuntimeBadge runtime={runtime} />} />
      <div className="agents-workspace-grid">
        <section className="workspace-panel agent-roster">
          <div className="workspace-panel-title"><span>Agent roster</span><Bot size={16} /></div>
          <div className="agent-cards">
            {agentRoster.map(({ name, role, icon: Icon, accent }, index) => {
              const activity = dashboard.activities[index]
              return (
                <article key={name} className={`agent-card ${accent}`}>
                  <span><Icon size={17} /></span>
                  <div><strong>{name}</strong><small>{role}</small></div>
                  <em><i /> {activity?.status === 'working' ? 'Working' : 'Ready'}</em>
                  <p>{activity?.action ?? 'Awaiting the next bounded task'}<small>{activity?.detail}</small></p>
                </article>
              )
            })}
          </div>
        </section>
        <MemoryRail
          memory={dashboard.memory}
          activities={dashboard.activities}
          regions={dashboard.regions}
          resilience={dashboard.resilience}
          runtime={runtime}
          outageState={outageState}
          outageResult={outageResult}
          outageError={outageError}
          onOutage={onOutage}
          onRestore={onRestore}
        />
      </div>
    </main>
  )
}

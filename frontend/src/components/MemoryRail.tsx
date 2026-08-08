import { useMemo, useState } from 'react'
import {
  Activity,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  History,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react'
import type { AgentActivity, MemoryEvent, OutageResult, OutageState, RegionNode, ResilienceEvidence, RuntimeContext } from '../types'

interface MemoryRailProps {
  memory: MemoryEvent
  activities: AgentActivity[]
  regions: RegionNode[]
  resilience: ResilienceEvidence
  runtime: RuntimeContext
  outageState: OutageState
  outageResult: OutageResult | null
  outageError: string | null
  onOutage: () => void
  onRestore: () => void
}

export function MemoryRail({ memory, activities, regions, resilience, runtime, outageState, outageResult, outageError, onOutage, onRestore }: MemoryRailProps) {
  const [tab, setTab] = useState<'memory' | 'agents'>('memory')
  const [memoryExpanded, setMemoryExpanded] = useState(false)
  const effectiveRuntime = outageResult?.runtime ?? runtime
  const isPersistent = effectiveRuntime.persistence === 'cockroachdb'
  const topologyVerified = outageResult?.topologyVerified ?? resilience.topologyVerified
  const survivalGoal = outageResult?.survivalGoal ?? resilience.survivalGoal
  const actualFailover = Boolean(outageResult?.actualRegionFailoverPerformed && topologyVerified)
  const durableTransactionRead = Boolean(outageResult?.memoryTransactionVerified && outageResult.memoryCheckDurable && effectiveRuntime.persistence === 'cockroachdb')
  const evidenceRegions = outageResult?.regions.length ? outageResult.regions : regions
  const visibleRegions = useMemo(() => evidenceRegions.slice(0, 3).map((region) => ({
    ...region,
    status: actualFailover && region.region === outageResult?.fromRegion ? 'failed' as const : topologyVerified ? region.status : 'standby' as const,
  })), [actualFailover, evidenceRegions, outageResult?.fromRegion, topologyVerified])

  const topologyLabel = topologyVerified
    ? 'Verified CockroachDB topology'
    : isPersistent ? 'CockroachDB topology not verified' : 'Illustrative routing labels'
  const topologyDetail = topologyVerified
    ? `${evidenceRegions.length} configured database regions · survival goal ${survivalGoal ?? 'not reported'}`
    : isPersistent ? 'Durable SQL is connected; regional topology evidence is absent' : 'No database-region evidence is available in this mode'

  const rehearsalSteps = [
    'Starting application-routing rehearsal',
    outageResult ? `Logical label ${outageResult.fromRegion} → ${outageResult.logicalActiveRegion}` : 'Updating the logical routing label',
    durableTransactionRead
      ? 'Durable same-transaction read-after-write verified'
      : outageResult?.memoryTransactionVerified ? 'Transient transaction read verified; durability not established' : 'Transaction-scoped memory verification not established',
    actualFailover ? 'Observed regional failover evidence received' : 'No node, zone, quorum, or regional failure performed',
  ]

  return (
    <aside className="memory-rail" aria-label="Shared agent memory and resilience">
      <div className="rail-section rail-tabs-section">
        <div className="rail-title-row">
          <h2><Database size={17} /> Shared memory</h2>
          <span className={`live-label ${effectiveRuntime.source}`}><i /> {isPersistent ? 'Persistent' : effectiveRuntime.apiConnected ? 'Ephemeral' : 'Snapshot'}</span>
        </div>
        <div className="rail-tabs" role="tablist" aria-label="Memory panel view">
          <button type="button" role="tab" aria-selected={tab === 'memory'} onClick={() => setTab('memory')}>Memory retrieval</button>
          <button type="button" role="tab" aria-selected={tab === 'agents'} onClick={() => setTab('agents')}>Agent traces</button>
        </div>
      </div>

      {tab === 'memory' ? (
        <section className="rail-section memory-card" aria-labelledby="memory-result-title">
          <div className="retrieved-label"><History size={14} /> Similar past event retrieved</div>
          <div className="memory-result">
            <div className="memory-thumbnail" aria-hidden="true"><span /><i /><b /></div>
            <div>
              <h3 id="memory-result-title">{memory.title}</h3>
              <p>{memory.location}</p>
              <strong>Similarity {memory.similarity.toFixed(2)}</strong>
              <small>{memory.source}</small>
            </div>
          </div>
          {memoryExpanded && <p className="memory-detail" id={`memory-detail-${memory.id}`}>{memory.detail}</p>}
          <button
            className="outline-button"
            type="button"
            aria-expanded={memoryExpanded}
            aria-controls={`memory-detail-${memory.id}`}
            onClick={() => setMemoryExpanded((expanded) => !expanded)}
          >
            {memoryExpanded ? 'Hide memory details' : 'View memory details'} <ChevronRight size={15} className={memoryExpanded ? 'expanded-chevron' : ''} />
          </button>
        </section>
      ) : (
        <section className="rail-section trace-summary">
          <div><Bot size={18} /><span><strong>{activities.length}</strong> agent traces</span></div>
          <div><Activity size={18} /><span><strong>1</strong> selected memory</span></div>
          <div><ShieldCheck size={18} /><span><strong>{isPersistent ? 'SQL' : '0'}</strong> {isPersistent ? 'durable provider' : 'durable writes'}</span></div>
        </section>
      )}

      <section className="rail-section agent-section" aria-labelledby="agent-activity-title">
        <h2 id="agent-activity-title"><Bot size={17} /> Agent activity</h2>
        <ol className="agent-list">
          {activities.slice(0, 5).map((activity) => (
            <li key={activity.id}>
              <time>{activity.time}</time>
              <i className={activity.status} aria-hidden="true" />
              <div><strong>{activity.action}</strong><span>{activity.detail}</span></div>
              {activity.status === 'complete' ? <Check size={14} className="complete-icon" /> : <RefreshCw size={14} className="spin" />}
            </li>
          ))}
        </ol>
      </section>

      <section className="rail-section continuity-section" aria-labelledby="continuity-title">
        <h2 id="continuity-title"><Server size={17} /> Resilience evidence</h2>
        <div className="region-cluster">
          <span className="cluster-label">{topologyLabel}</span>
          <div className="region-nodes">
            {visibleRegions.map((region) => (
              <div className={`region-node ${region.status}`} key={region.id}>
                <span className="db-node"><Database size={18} /></span>
                <strong>{region.region}</strong>
                <small>{region.locality}</small>
                <em><i /> {region.status === 'failed' ? 'Observed unavailable' : topologyVerified ? 'Configured' : 'Logical label'}</em>
              </div>
            ))}
          </div>
          <div className="quorum-line">
            <span className={topologyVerified ? '' : 'warn'}>{topologyDetail}</span>
            <strong>{topologyVerified ? 'TOPOLOGY VERIFIED' : 'LOGICAL ONLY'}</strong>
          </div>
        </div>
      </section>

      <section className="rail-section outage-section" aria-labelledby="outage-title">
        <div className="outage-heading">
          <div><span id="outage-title">Routing continuity rehearsal</span><small>Verify a logical label and transaction read; do not imply infrastructure failure</small></div>
          <CircleDot size={16} />
        </div>
        <button className={`outage-button ${outageState}`} type="button" onClick={outageState === 'complete' ? onRestore : onOutage} disabled={outageState === 'running'}>
          {outageState === 'idle' && <><Server size={16} /> Run logical routing rehearsal</>}
          {outageState === 'running' && <><RefreshCw size={16} className="spin" /> Verifying transaction…</>}
          {outageState === 'complete' && <><RefreshCw size={16} /> Reset rehearsal view</>}
        </button>
        {outageError && <div className="outage-error" role="alert">{outageError}</div>}
        <ol className={`outage-log ${outageState}`} aria-live="polite">
          {rehearsalSteps.map((step, index) => (
            <li key={step} style={{ '--delay': `${index * 180}ms` } as React.CSSProperties}>
              <time>STEP {index + 1}</time>
              <span>{step}{index === 2 && outageState === 'complete' && <small>{outageResult?.memoryCheckScope ?? 'No durable verification evidence'}</small>}{index === 3 && outageState === 'complete' && <small>{actualFailover && outageResult?.observedRpoSeconds != null ? `Observed RPO ${outageResult.observedRpoSeconds}s` : 'Observed RPO not measured'}</small>}</span>
              {outageState === 'complete' && <Check size={13} />}
            </li>
          ))}
        </ol>
        {outageState === 'complete' && (
          <div className={`continuity-proof ${actualFailover ? 'observed' : ''}`}>
            <ShieldCheck size={14} />
            {actualFailover
              ? 'Actual regional failover and topology evidence received'
              : durableTransactionRead
                ? 'Durable same-transaction read-after-write verified · regional failover not performed'
                : outageResult?.memoryTransactionVerified
                  ? 'Transient transaction read verified · durable continuity not established'
                : 'Logical rehearsal only · durable memory continuity not verified'}
          </div>
        )}
      </section>
    </aside>
  )
}

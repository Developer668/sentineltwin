import { ArrowRight, Check, ChevronRight, Code2, Database, TrendingDown } from 'lucide-react'
import type { PlanMetric, RuntimeContext, TimelineEvent } from '../types'

interface OutcomePanelProps {
  timeline: TimelineEvent[]
  metrics: PlanMetric[]
  resources: Array<{ label: string; value: number }>
  planVersion: string
  runtime: RuntimeContext
  onInfo: (feature: string) => void
}

export function OutcomePanel({ timeline, metrics, resources, planVersion, runtime, onInfo }: OutcomePanelProps) {
  const planLabel = runtime.persistence === 'cockroachdb' ? 'Learned plan' : runtime.apiConnected ? 'Demo plan' : 'Snapshot plan'
  return (
    <section className="outcome-panel" aria-label="Simulation results and event timeline">
      <div className="simulation-timeline">
        <div className="bottom-heading"><h2>Simulation timeline</h2><Code2 size={15} /></div>
        <ol>
          {timeline.slice(0, 5).map((event) => (
            <li key={event.id}>
              <time>{event.time}</time>
              <span className="timeline-node"><Check size={10} /></span>
              <span><strong>{event.title}</strong><small>{event.detail}</small></span>
            </li>
          ))}
        </ol>
      </div>

      <div className="comparison">
        <div className="comparison-head">
          <h2>Outcome comparison</h2>
          <span>{planLabel} {planVersion}</span>
        </div>
        <div className="comparison-labels"><span>Without past memory</span><ArrowRight size={17} /><span>With retrieved memory</span></div>
        <div className="metric-grid">
          {metrics.map((metric) => (
            <div className="metric-row" key={metric.label}>
              <span className="metric-label">{metric.label}</span>
              <strong className="before-value">{metric.before}</strong>
              <ArrowRight size={15} className="metric-arrow" />
              <strong className="after-value">{metric.after}</strong>
              {metric.delta && <em><TrendingDown size={12} /> {metric.delta}</em>}
            </div>
          ))}
        </div>
        <div className="memory-proof"><Database size={13} /> {runtime.persistence === 'cockroachdb' ? 'Retrieved outcomes changed this plan' : 'Curated demo outcomes shape this preview'}</div>
      </div>

      <div className="resource-plan">
        <div className="bottom-heading"><h2>Resource plan (draft)</h2><span>48 total</span></div>
        <dl>
          {resources.slice(0, 8).map((resource) => (
            <div key={resource.label}><dt>{resource.label}</dt><dd>{resource.value}</dd></div>
          ))}
        </dl>
        <button className="outline-button" type="button" onClick={() => onInfo('Full resource-plan review')}>View full plan <ChevronRight size={15} /></button>
      </div>
    </section>
  )
}

import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, Database, Server } from 'lucide-react'
import type { AgentActivity, MemoryEvent, ResilienceEvidence, RuntimeContext } from '../types'

interface EvidenceCarouselProps {
  memory: MemoryEvent
  activities: AgentActivity[]
  resilience: ResilienceEvidence
  runtime: RuntimeContext
}

export function EvidenceCarousel({ memory, activities, resilience, runtime }: EvidenceCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const latestActivity = activities[0]
  const slides = useMemo(() => [
    {
      label: 'Retrieved memory',
      title: memory.title,
      quote: memory.detail,
      detail: `${memory.location} · similarity ${memory.similarity.toFixed(2)} · ${runtime.persistence === 'cockroachdb' ? 'durable retrieval' : 'preview retrieval'}`,
      icon: Database,
      accent: 'lime',
    },
    {
      label: 'Agent trace',
      title: latestActivity?.action ?? 'No current agent trace',
      quote: latestActivity?.detail ?? 'No active workflow evidence is available in this runtime.',
      detail: latestActivity ? `${latestActivity.agent} · ${latestActivity.time} · ${latestActivity.status}` : runtime.detail,
      icon: Bot,
      accent: 'cyan',
    },
    {
      label: 'Continuity evidence',
      title: resilience.topologyVerified ? 'Database topology verified' : 'Routing labels only',
      quote: resilience.topologyVerified
        ? `CockroachDB reports a ${resilience.survivalGoal ?? 'configured'} survival goal. Observed recovery remains separate evidence.`
        : 'No database-region proof is available, so the interface does not claim quorum, regional failover, or a measured RPO.',
      detail: `${resilience.topologySource} · ${runtime.label}`,
      icon: Server,
      accent: resilience.topologyVerified ? 'lime' : 'orange',
    },
  ], [latestActivity, memory, resilience, runtime])
  const slide = slides[activeIndex]
  const Icon = slide.icon

  const move = (direction: number) => setActiveIndex((current) => (current + direction + slides.length) % slides.length)

  return (
    <section className={`evidence-carousel accent-${slide.accent}`} aria-labelledby="evidence-carousel-title">
      <div className="carousel-topline">
        <h2 id="evidence-carousel-title">Evidence, not theater</h2>
        <span>{String(activeIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span>
      </div>

      <div className="carousel-medallions" aria-hidden="true">
        {slides.map(({ icon: SlideIcon, accent, label }, index) => (
          <span className={`carousel-medallion accent-${accent} ${index === activeIndex ? 'active' : ''}`} key={label}>
            <SlideIcon size={17} />
          </span>
        ))}
      </div>

      <div className="carousel-copy" aria-live="polite">
        <span>{slide.label}</span>
        <h3><Icon size={20} aria-hidden="true" /> {slide.title}</h3>
        <blockquote>{slide.quote}</blockquote>
        <p>{slide.detail}</p>
      </div>

      <div className="carousel-controls">
        <button type="button" onClick={() => move(-1)} aria-label="Previous evidence"><ArrowLeft size={17} /></button>
        <button type="button" onClick={() => move(1)} aria-label="Next evidence"><ArrowRight size={17} /></button>
      </div>
    </section>
  )
}

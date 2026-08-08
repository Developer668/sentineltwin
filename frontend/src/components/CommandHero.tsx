import { ArrowDownRight, Play, Satellite } from 'lucide-react'

interface CommandHeroProps {
  onRunSimulation: () => void
  onAssessSatellite: () => void
}

const supportingCopy = 'Connect satellite evidence, compound simulations, and shared operational memory before separate hazards become one response problem.'
const supportingWords = supportingCopy.split(' ')

export function CommandHero({ onRunSimulation, onAssessSatellite }: CommandHeroProps) {
  return (
    <section className="command-hero" aria-labelledby="command-hero-title">
      <div className="hero-copy max-w-6xl">
        <h1 id="command-hero-title">
          Model cascading <span className="hero-inline-terrain" aria-hidden="true" /> risk before response windows close.
        </h1>
        <p className="hero-supporting-copy">
          {supportingWords.map((word, index) => (
            <span key={`${word}-${index}`}>{word}{index === supportingWords.length - 1 ? '' : ' '}</span>
          ))}
        </p>
        <div className="hero-actions">
          <button className="hero-primary" type="button" onClick={onRunSimulation}>
            <Play size={17} fill="currentColor" aria-hidden="true" /> Run a compound scenario
          </button>
          <button className="hero-secondary" type="button" onClick={onAssessSatellite}>
            <Satellite size={17} aria-hidden="true" /> Assess source imagery
          </button>
        </div>
      </div>

      <div className="hero-visual scroll-image" data-scroll-image aria-hidden="true">
        <img src="/california-terrain.png" alt="" />
        <span className="hero-radar hero-radar-one" />
        <span className="hero-radar hero-radar-two" />
        <span className="hero-route" />
      </div>

      <a className="hero-scroll-cue" href="#regional-picture">
        Enter the regional picture <ArrowDownRight size={16} aria-hidden="true" />
      </a>
    </section>
  )
}

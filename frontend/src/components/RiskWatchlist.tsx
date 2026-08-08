import { Activity, ChevronRight, Flame, MoreVertical } from 'lucide-react'
import type { HazardLayer, LocationRisk } from '../types'

interface RiskWatchlistProps {
  locations: LocationRisk[]
  selectedId: string
  onSelect: (id: string) => void
  onInfo: (feature: string) => void
}

const hazardLabel = (hazard: HazardLayer) => hazard === 'seismic' ? 'Seismic' : hazard === 'fire' ? 'Fire' : 'Composite'

export function RiskWatchlist({ locations, selectedId, onSelect, onInfo }: RiskWatchlistProps) {
  return (
    <section className="watchlist" aria-labelledby="watchlist-title">
      <div className="panel-heading">
        <h2 id="watchlist-title">Risk watchlist</h2>
        <button className="icon-button compact" type="button" aria-label="Watchlist options" onClick={() => onInfo('Watchlist filters')}><MoreVertical size={16} /></button>
      </div>

      <div className="watchlist-rows">
        {locations.slice(0, 3).map((location) => {
          const active = location.id === selectedId
          return (
            <button
              key={location.id}
              className={`location-row ${active ? 'selected' : ''}`}
              type="button"
              onClick={() => onSelect(location.id)}
              aria-pressed={active}
            >
              <span className="location-name">{location.name}</span>
              <span className="location-county">{location.county}</span>
              <span className="location-hazards">
                {location.hazards.includes('fire') && <Flame size={15} className="fire-color" fill="currentColor" aria-label="Fire" />}
                {location.hazards.includes('seismic') && <Activity size={15} className="seismic-color" aria-label="Seismic" />}
                <em className={`risk-tag ${location.risk}`}>{location.risk} risk</em>
              </span>
              <span className="hazard-words">{location.hazards.map(hazardLabel).join(' · ')}</span>
              <span className="impact-label">Impact window</span>
              <span className="impact-value">{location.impactWindow}</span>
              <ChevronRight className="row-chevron" size={17} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <button className="view-all" type="button" onClick={() => onInfo(`All ${locations.length} risk locations`)}>View all {locations.length} locations <ChevronRight size={16} /></button>
    </section>
  )
}

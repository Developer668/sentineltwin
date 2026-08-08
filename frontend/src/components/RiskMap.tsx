import { Activity, Check, Flame, Layers3, LocateFixed, Minus, Plus } from 'lucide-react'
import type { HazardLayer, LocationRisk, RuntimeContext } from '../types'

interface RiskMapProps {
  layer: HazardLayer
  onLayerChange: (layer: HazardLayer) => void
  locations: LocationRisk[]
  selected: LocationRisk
  onSelect: (id: string) => void
  runtime: RuntimeContext
  onInfo: (feature: string) => void
}

const layers: Array<{ id: HazardLayer; label: string; icon: typeof Flame }> = [
  { id: 'composite', label: 'Composite', icon: Layers3 },
  { id: 'fire', label: 'Fire', icon: Flame },
  { id: 'seismic', label: 'Seismic', icon: Activity },
]

const cityLabels = [
  { name: 'Eureka', x: 20, y: 10 }, { name: 'Redding', x: 36, y: 13 },
  { name: 'Chico', x: 43, y: 22 }, { name: 'Sacramento', x: 46, y: 34 },
  { name: 'San Francisco', x: 29, y: 44 }, { name: 'San Jose', x: 37, y: 50 },
  { name: 'Fresno', x: 55, y: 56 }, { name: 'Bakersfield', x: 63, y: 69 },
  { name: 'Los Angeles', x: 67, y: 83 }, { name: 'San Diego', x: 78, y: 94 },
  { name: 'Reno', x: 59, y: 23 }, { name: 'Las Vegas', x: 88, y: 66 },
]

export function RiskMap({ layer, onLayerChange, locations, selected, onSelect, runtime, onInfo }: RiskMapProps) {
  const showFire = layer !== 'seismic'
  const showSeismic = layer !== 'fire'

  return (
    <section className={`risk-map layer-${layer}`} aria-label="California multi-hazard risk map">
      <div className="map-grid" aria-hidden="true" />
      <svg className="map-art" viewBox="0 0 1000 720" role="img" aria-label={`${layer} risk visualization for California`}>
        <defs>
          <linearGradient id="terrain" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#1a2525" />
            <stop offset=".48" stopColor="#15201f" />
            <stop offset="1" stopColor="#0b1518" />
          </linearGradient>
          <radialGradient id="fireGlow">
            <stop stopColor="#ffb03a" stopOpacity=".95" />
            <stop offset=".24" stopColor="#ff5b12" stopOpacity=".76" />
            <stop offset="1" stopColor="#ff3b0a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="quakeGlow">
            <stop stopColor="#d8c5ff" stopOpacity=".9" />
            <stop offset=".22" stopColor="#9b5cff" stopOpacity=".6" />
            <stop offset="1" stopColor="#7a3fff" stopOpacity="0" />
          </radialGradient>
          <pattern id="topo" width="90" height="70" patternUnits="userSpaceOnUse">
            <path d="M-20 48 C10 10 50 85 115 22" fill="none" stroke="#a6b2aa" strokeOpacity=".12" strokeWidth="1" />
            <path d="M-12 59 C28 24 61 98 115 38" fill="none" stroke="#a6b2aa" strokeOpacity=".085" strokeWidth="1" />
          </pattern>
          <filter id="soft"><feGaussianBlur stdDeviation="10" /></filter>
          <filter id="tiny"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>

        <path className="state-shadow" d="M188 18 L436 20 L469 80 L493 142 L525 205 L559 284 L602 354 L650 414 L696 474 L770 544 L850 608 L827 676 L726 650 L638 599 L561 548 L493 486 L421 432 L364 363 L302 293 L260 226 L224 150 Z" />
        <path className="state-fill" d="M188 18 L436 20 L469 80 L493 142 L525 205 L559 284 L602 354 L650 414 L696 474 L770 544 L850 608 L827 676 L726 650 L638 599 L561 548 L493 486 L421 432 L364 363 L302 293 L260 226 L224 150 Z" fill="url(#terrain)" />
        <path className="state-topo" d="M188 18 L436 20 L469 80 L493 142 L525 205 L559 284 L602 354 L650 414 L696 474 L770 544 L850 608 L827 676 L726 650 L638 599 L561 548 L493 486 L421 432 L364 363 L302 293 L260 226 L224 150 Z" fill="url(#topo)" />
        <path className="coast-line" d="M188 18 L224 150 L260 226 L302 293 L364 363 L421 432 L493 486 L561 548 L638 599 L726 650 L827 676" />

        <g className="terrain-lines" aria-hidden="true">
          <path d="M316 60 C370 118 338 175 416 243 S470 350 550 416 S610 510 746 607" />
          <path d="M394 47 C432 110 413 173 481 237 S540 348 608 395 S697 500 802 566" />
          <path d="M253 117 C320 137 328 210 395 259 S441 374 526 431 S599 535 705 584" />
          <path d="M530 71 C573 170 602 202 644 272 S724 394 815 467" />
        </g>

        <g className="roads" aria-hidden="true">
          <path className="route route-main" d="M315 107 C385 164 402 255 470 322 C527 377 550 470 628 532 C696 583 760 611 804 653" />
          <path className="route" d="M260 150 C340 220 389 267 470 322 C565 388 620 442 686 516" />
          <path className="route" d="M440 72 C476 168 486 242 526 300 C570 365 658 386 737 448 C782 483 834 517 913 534" />
          <path className="route cross" d="M371 310 C468 291 570 292 690 340" />
        </g>

        {showFire && (
          <g className="fire-layer" aria-hidden="true">
            <circle cx="300" cy="167" r="100" fill="url(#fireGlow)" filter="url(#soft)" />
            <circle cx="720" cy="500" r="126" fill="url(#fireGlow)" filter="url(#soft)" />
            <circle cx="585" cy="408" r="52" fill="url(#fireGlow)" filter="url(#tiny)" />
            {[0,1,2,3,4,5,6].map((i) => <circle key={i} cx={275 + i * 18} cy={142 + (i % 3) * 21} r={4 + (i % 2) * 3} className="ember" />)}
            {[0,1,2,3,4,5,6,7].map((i) => <circle key={i} cx={670 + i * 18} cy={478 + (i % 4) * 16} r={4 + (i % 3)} className="ember" />)}
          </g>
        )}

        {showSeismic && (
          <g className="seismic-layer" aria-hidden="true">
            <path d="M335 182 C377 254 410 306 455 362 S535 433 584 489 S665 545 728 602" />
            <path d="M493 120 C522 176 550 224 584 276 S627 341 674 381" />
            {[34,48,62,76].map((r) => <circle key={r} cx="640" cy="384" r={r} />)}
            <circle cx="640" cy="384" r="85" fill="url(#quakeGlow)" filter="url(#tiny)" />
          </g>
        )}

        <g className="risk-corridor" aria-hidden="true">
          <path d="M301 168 C355 213 407 285 470 323 C530 360 568 407 640 384 C661 431 694 470 720 500 C750 546 790 591 822 650" />
          {[0,1,2,3,4,5,6,7,8].map((i) => <circle key={i} cx={310 + i * 61} cy={176 + i * 54} r="4" />)}
        </g>
      </svg>

      <span className="california-label">California</span>
      <span className="ocean-label">Pacific<br />Ocean</span>
      {cityLabels.map((city) => (
        <span key={city.name} className="city-label" style={{ left: `${city.x}%`, top: `${city.y}%` }}><i />{city.name}</span>
      ))}

      {locations.slice(0, 3).map((location) => {
        const isSelected = location.id === selected.id
        const visible = layer === 'composite' || location.hazards.includes(layer)
        return (
          <button
            key={location.id}
            type="button"
            className={`map-hotspot ${location.risk} ${isSelected ? 'selected' : ''} ${visible ? '' : 'dimmed'}`}
            style={{ left: `${location.x}%`, top: `${location.y}%` }}
            onClick={() => onSelect(location.id)}
            aria-label={`Select ${location.name}, ${location.risk} risk`}
          >
            <span className="hotspot-rings" aria-hidden="true" />
            <span className="hotspot-core" aria-hidden="true" />
            <span className="hotspot-card">
              <strong>{location.name}</strong>
              <em>{location.risk}</em>
              <small>{location.fireScore}% fire · {location.seismicScore}% EQ</small>
            </span>
          </button>
        )
      })}

      <div className="layer-control" role="group" aria-label="Risk layers">
        <div className="layer-title"><span>Layers</span><Layers3 size={15} /></div>
        {layers.map(({ id, label, icon: Icon }) => (
          <button key={id} className={layer === id ? 'selected' : ''} type="button" onClick={() => onLayerChange(id)} aria-pressed={layer === id}>
            <span className="layer-check">{layer === id && <Check size={12} />}</span>
            <Icon size={15} className={`${id}-color`} />
            {label}
          </button>
        ))}
      </div>

      <div className="map-tools" aria-label="Map controls">
        <button type="button" aria-label="Zoom in" onClick={() => onInfo('Interactive map zoom')}><Plus size={17} /></button>
        <button type="button" aria-label="Zoom out" onClick={() => onInfo('Interactive map zoom')}><Minus size={17} /></button>
        <button type="button" aria-label="Center selected location" onClick={() => onInfo(`Center map on ${selected.name}`)}><LocateFixed size={17} /></button>
      </div>

      <div className="scale-bar" aria-hidden="true"><span>N</span><i /><small>0&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 50&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 100&nbsp;&nbsp;&nbsp; 150 mi</small></div>
      <div className="map-attribution">Synthetic terrain · {runtime.persistence === 'cockroachdb' ? 'live API risk overlay' : 'deterministic demo overlay'}</div>
    </section>
  )
}

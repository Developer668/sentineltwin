import { useEffect, useRef, useState } from 'react'
import { Activity, Check, ChevronRight, Clock3, Database, Flame, Play, RefreshCw, ShieldAlert, X } from 'lucide-react'
import type { HazardLayer, LocationRisk, RuntimeContext, SimulationRequest, SimulationResult } from '../types'
import { useDialogFocus } from '../lib/useDialogFocus'
import { describeApiError } from '../lib/api'

interface SimulationModalProps {
  open: boolean
  location: LocationRisk
  runtime: RuntimeContext
  initialLayer: HazardLayer
  onClose: () => void
  onSubmit: (request: SimulationRequest) => Promise<SimulationResult>
  onComplete: (result: SimulationResult) => void
}

const hazardOrder: HazardLayer[] = ['fire', 'seismic', 'composite']

function providerLabel(provider: string): string {
  if (provider === 'amazon-bedrock') return 'Amazon Bedrock'
  if (provider === 'deterministic-planner') return 'Deterministic planner'
  if (provider === 'local-deterministic-preview') return 'Local deterministic preview'
  return provider.replaceAll('-', ' ')
}

export function SimulationModal({ open, location, runtime, initialLayer, onClose, onSubmit, onComplete }: SimulationModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [hazard, setHazard] = useState<HazardLayer>(initialLayer)
  const [intensity, setIntensity] = useState(82)
  const [horizonHours, setHorizonHours] = useState(24)
  const [impacts, setImpacts] = useState<string[]>(['Power grid', 'Transportation', 'Water systems'])
  const [useMemory, setUseMemory] = useState(true)
  const [status, setStatus] = useState<'editing' | 'running' | 'complete'>('editing')
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  useDialogFocus(open, dialogRef)

  useEffect(() => {
    if (open) {
      setHazard(initialLayer)
      setStatus('editing')
      setResult(null)
      setError(null)
    }
  }, [open, initialLayer])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && status !== 'running' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, status])

  if (!open) return null

  const toggleImpact = (impact: string) => setImpacts((current) => current.includes(impact) ? current.filter((item) => item !== impact) : [...current, impact])

  const run = async () => {
    setStatus('running')
    setError(null)
    try {
      const nextResult = await onSubmit({ locationId: location.id, hazard, intensity, horizonHours, cascadingImpacts: impacts, useMemory })
      setResult(nextResult)
      setStatus('complete')
      onComplete(nextResult)
    } catch (nextError) {
      setStatus('editing')
      setError(describeApiError(nextError, 'run this simulation'))
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && status !== 'running' && onClose()}>
      <div ref={dialogRef} className="simulation-modal" role="dialog" aria-modal="true" aria-labelledby="simulation-title" aria-describedby={error ? 'simulation-error' : undefined} aria-busy={status === 'running'}>
        <header>
          <div><span>Scenario builder</span><h2 id="simulation-title">Run compound simulation</h2></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={status === 'running'} aria-label="Close simulation" data-autofocus><X size={18} /></button>
        </header>

        {status === 'complete' && result ? (
          <div className="simulation-success">
            <span className="success-mark"><Check size={26} /></span>
            <h3>{result.persisted ? 'Learned outcome persisted' : 'Scenario preview generated'}</h3>
            <p>{result.persisted
              ? `${providerLabel(result.planProvider)} generated plan ${result.planVersion} after recalling ${result.retrievedMemories} memories. The learned outcome was committed to CockroachDB as ${result.learnedMemoryId}.`
              : result.runtime.source === 'cockroachdb'
                ? `${providerLabel(result.planProvider)} returned plan ${result.planVersion}, but the response did not include learned-memory commit evidence. SentinelTwin does not claim this outcome was persisted.`
              : result.runtime.source === 'api-demo'
                ? `${providerLabel(result.planProvider)} completed the scenario with ${result.retrievedMemories} deterministic demo memories. This API state is ephemeral and may reset.`
                : 'SentinelTwin generated a deterministic local preview from the bundled snapshot. No API, AWS model, or database write was used.'}</p>
            <div className="success-stats">
              <span><small>Plan confidence</small><strong>{result.confidence}%</strong></span>
              <span><small>Memories used</small><strong>{result.retrievedMemories}</strong></span>
              <span><small>Persistence</small><strong>{result.persisted ? 'CockroachDB' : result.runtime.persistence === 'ephemeral' ? 'Ephemeral' : 'None'}</strong></span>
            </div>
            <section className="agent-loop-evidence" aria-label="Agent loop evidence">
              <div className="agent-loop-heading">
                <span><small>Plan provider</small><strong>{providerLabel(result.planProvider)}</strong></span>
                <span><small>{result.persisted ? 'Learned memory · durable' : result.learnedMemoryId ? 'Learned memory · ephemeral' : 'Learned memory'}</small><strong>{result.learnedMemoryId ?? 'No write'}</strong></span>
              </div>
              {result.recommendations.length > 0 && (
                <ol>
                  {result.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
                </ol>
              )}
              <small className="agent-loop-path">{result.learningLoop} · recalled {result.recalledMemoryIds.length ? result.recalledMemoryIds.join(', ') : 'no memory IDs'}</small>
            </section>
            <div className="human-review-notice"><ShieldAlert size={15} /><span><strong>Human review required</strong><small>Decision support only—validate recommendations against current incident command and field intelligence.</small></span></div>
            <button className="primary-button full" type="button" onClick={onClose}>{result.persisted ? 'Review learned outcome' : 'Return to command center'} <ChevronRight size={16} /></button>
          </div>
        ) : (
          <>
            <div className="scenario-summary">
              <ShieldAlert size={18} />
              <div><span>Selected risk zone</span><strong>{location.name}</strong><small>{location.county} · impact in {location.impactWindow}</small></div>
            </div>

            <div className="form-section">
              <label className="field-label">Primary hazard</label>
              <div className="hazard-options" role="radiogroup" aria-label="Primary hazard" onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                event.preventDefault()
                const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1
                const next = hazardOrder[(hazardOrder.indexOf(hazard) + direction + hazardOrder.length) % hazardOrder.length]
                setHazard(next)
                window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-hazard="${next}"]`)?.focus())
              }}>
                <button data-hazard="fire" type="button" role="radio" aria-checked={hazard === 'fire'} tabIndex={hazard === 'fire' ? 0 : -1} className={hazard === 'fire' ? 'selected' : ''} onClick={() => setHazard('fire')}><Flame size={17} /> Wildfire</button>
                <button data-hazard="seismic" type="button" role="radio" aria-checked={hazard === 'seismic'} tabIndex={hazard === 'seismic' ? 0 : -1} className={hazard === 'seismic' ? 'selected' : ''} onClick={() => setHazard('seismic')}><Activity size={17} /> Earthquake</button>
                <button data-hazard="composite" type="button" role="radio" aria-checked={hazard === 'composite'} tabIndex={hazard === 'composite' ? 0 : -1} className={hazard === 'composite' ? 'selected' : ''} onClick={() => setHazard('composite')}><ShieldAlert size={17} /> Compound</button>
              </div>
            </div>

            <div className="form-columns">
              <label>
                <span className="field-label">Intensity <b>{intensity}%</b></span>
                <input type="range" min="40" max="100" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} />
              </label>
              <label>
                <span className="field-label"><Clock3 size={13} /> Time horizon</span>
                <select value={horizonHours} onChange={(event) => setHorizonHours(Number(event.target.value))}>
                  <option value={12}>12 hours</option><option value={24}>24 hours</option><option value={48}>48 hours</option><option value={72}>72 hours</option>
                </select>
              </label>
            </div>

            <fieldset className="impact-options">
              <legend className="field-label">Include cascading impacts</legend>
              {['Power grid', 'Transportation', 'Water systems', 'Communications'].map((impact) => (
                <label key={impact}><input type="checkbox" checked={impacts.includes(impact)} onChange={() => toggleImpact(impact)} /><span><Check size={11} /></span>{impact}</label>
              ))}
            </fieldset>

            <label className="memory-switch">
              <span className="switch-copy"><Database size={18} /><span><strong>Retrieve shared memory</strong><small>{runtime.persistence === 'cockroachdb' ? 'CockroachDB vector + spatial similarity' : runtime.apiConnected ? 'Deterministic in-memory similarity (ephemeral)' : 'Bundled deterministic memory preview'}</small></span></span>
              <input type="checkbox" checked={useMemory} onChange={(event) => setUseMemory(event.target.checked)} />
              <span className="switch-track"><i /></span>
            </label>

            {status === 'running' && (
              <div className="running-state" role="status" aria-live="polite"><RefreshCw className="spin" size={16} /><span><strong>Agents are simulating this scenario</strong><small>Retrieving memory → forecasting spread → optimizing resources</small></span></div>
            )}

            {error && <div id="simulation-error" className="workflow-error" role="alert">{error}</div>}

            <footer>
              <button className="secondary-button" type="button" onClick={onClose} disabled={status === 'running'}>Cancel</button>
              <button className="primary-button" type="button" onClick={run} disabled={status === 'running'}>
                {status === 'running' ? <RefreshCw size={16} className="spin" /> : <Play size={16} fill="currentColor" />} {status === 'running' ? 'Running agents…' : error ? 'Retry simulation' : 'Run simulation'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import { Check, CloudUpload, Database, FileImage, Image as ImageIcon, RefreshCw, Satellite, ShieldCheck, X } from 'lucide-react'
import { useDialogFocus } from '../lib/useDialogFocus'
import { describeApiError } from '../lib/api'
import type { LocationRisk, RuntimeContext, SatelliteAssessment, SatelliteAssessmentRequest, SatelliteAssessmentStage } from '../types'

type AssessmentStage = 'select' | SatelliteAssessmentStage | 'complete' | 'error'
type ImageryMode = 'demo' | 'upload' | 'open-data'

interface SatelliteAssessmentModalProps {
  open: boolean
  location: LocationRisk
  runtime: RuntimeContext
  onClose: () => void
  onSubmit: (request: SatelliteAssessmentRequest, onStage: (stage: SatelliteAssessmentStage) => void) => Promise<SatelliteAssessment>
  onComplete: (result: SatelliteAssessment) => void
}

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maximumBytes = 3.5 * 1024 * 1024
const santaRosaSentinelKey = 'tiles/10/S/EH/2024/7/15/0/R60m/TCI.jp2'
const sentinelKeyPattern = /^tiles\/(?:[1-9]|[1-5][0-9]|60)\/[A-Z]\/[A-Z]{2}\/20[1-9][0-9]\/(?:[1-9]|1[0-2])\/(?:[1-9]|[12][0-9]|3[01])\/[0-9]{1,3}\/R60m\/TCI\.jp2$/
const allModes: ImageryMode[] = ['demo', 'upload', 'open-data']

const stageCopy: Record<Exclude<AssessmentStage, 'select' | 'complete' | 'error'>, { title: string; detail: string }> = {
  authorizing: { title: 'Authorizing secure upload', detail: 'Requesting a short-lived Amazon S3 form' },
  uploading: { title: 'Uploading into quarantine', detail: 'Sending the file directly to private Amazon S3' },
  importing: { title: 'Importing real Sentinel-2 imagery', detail: 'Copying an allowlisted L2A true-colour scene from AWS Open Data' },
  scanning: { title: 'Scanning quarantined imagery', detail: 'Waiting for an Amazon GuardDuty malware verdict before analysis' },
  assessing: { title: 'Assessing terrain and exposure', detail: 'Running the selected risk-assessment pipeline' },
}

export function SatelliteAssessmentModal({ open, location, runtime, onClose, onSubmit, onComplete }: SatelliteAssessmentModalProps) {
  const inputId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const demoAllowed = runtime.persistence !== 'cockroachdb'
  const modeOrder = demoAllowed ? allModes : allModes.filter((item) => item !== 'demo')
  const [mode, setMode] = useState<ImageryMode>(demoAllowed ? 'demo' : 'open-data')
  const [file, setFile] = useState<File | null>(null)
  const [sourceKey, setSourceKey] = useState(santaRosaSentinelKey)
  const [stage, setStage] = useState<AssessmentStage>('select')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SatelliteAssessment | null>(null)
  useDialogFocus(open, dialogRef)

  useEffect(() => {
    if (!open) return
    setMode(demoAllowed ? 'demo' : 'open-data')
    setFile(null)
    setSourceKey(santaRosaSentinelKey)
    setStage('select')
    setError(null)
    setResult(null)
  }, [demoAllowed, open, location.id])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && !['authorizing', 'uploading', 'importing', 'scanning', 'assessing'].includes(stage) && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, stage])

  if (!open) return null

  const busy = ['authorizing', 'uploading', 'importing', 'scanning', 'assessing'].includes(stage)
  const validSourceKey = sentinelKeyPattern.test(sourceKey.trim())

  const selectFile = (nextFile?: File) => {
    setError(null)
    setResult(null)
    setStage('select')
    if (!nextFile) {
      setFile(null)
      return
    }
    if (!allowedTypes.has(nextFile.type)) {
      setFile(null)
      setError('Choose a JPEG, PNG, or WebP image.')
      return
    }
    if (nextFile.size > maximumBytes) {
      setFile(null)
      setError('Image must be 3.5 MB or smaller for multimodal assessment.')
      return
    }
    setFile(nextFile)
  }

  const assess = async () => {
    if (mode === 'demo' && !demoAllowed) {
      setError('Deterministic imagery is disabled when CockroachDB persistence is active. Use a scanned upload or Sentinel-2 scene.')
      setStage('error')
      return
    }
    if (mode === 'upload' && !file) {
      setError('Choose an image before starting the assessment.')
      setStage('error')
      return
    }
    if (mode === 'upload' && !runtime.apiConnected) {
      setError('Image upload requires the SentinelTwin API and an S3 artifact bucket. Start the local API or use the built-in demo tile.')
      setStage('error')
      return
    }
    if (mode === 'open-data' && !runtime.apiConnected) {
      setError('AWS Open Data import requires the SentinelTwin API and cloud artifact bucket.')
      setStage('error')
      return
    }
    if (mode === 'open-data' && !validSourceKey) {
      setError('Enter an allowlisted Sentinel-2 L2A R60m/TCI.jp2 object key.')
      setStage('error')
      return
    }
    setError(null)
    setStage(mode === 'upload' ? 'authorizing' : mode === 'open-data' ? 'importing' : 'assessing')
    try {
      const assessment = await onSubmit(
        mode === 'upload'
          ? { locationId: location.id, file: file ?? undefined }
          : mode === 'open-data'
            ? { locationId: location.id, sentinelSourceKey: sourceKey.trim() }
          : { locationId: location.id, demoTile: 'california-terrain' },
        setStage,
      )
      setResult(assessment)
      setStage('complete')
      onComplete(assessment)
    } catch (nextError) {
      setError(describeApiError(nextError, mode === 'upload' ? 'finish the uploaded imagery assessment' : mode === 'open-data' ? 'import and assess Sentinel-2 imagery' : 'assess the demo tile'))
      setStage('error')
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div ref={dialogRef} className="satellite-modal" role="dialog" aria-modal="true" aria-labelledby="satellite-title" aria-describedby={error ? 'satellite-error' : undefined} aria-busy={busy}>
        <header>
          <div><span>Satellite risk assessor</span><h2 id="satellite-title">Analyze source imagery</h2></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close imagery assessment" data-autofocus><X size={18} /></button>
        </header>

        {stage === 'complete' && result ? (
          <div className="assessment-result">
            <div className="assessment-result-heading">
              <span className="success-mark"><Check size={24} /></span>
              <div>
                <h3>Risk assessment complete</h3>
                <p>{result.summary}</p>
              </div>
            </div>
            <div className="risk-score-grid" aria-label="Assessed risk scores">
              <span><small>Wildfire</small><strong>{result.fireRisk}%</strong><i style={{ '--score': `${result.fireRisk}%` } as React.CSSProperties} /></span>
              <span><small>Earthquake</small><strong>{result.earthquakeRisk}%</strong><i style={{ '--score': `${result.earthquakeRisk}%` } as React.CSSProperties} /></span>
              <span><small>Combined</small><strong>{result.combinedRisk}%</strong><i style={{ '--score': `${result.combinedRisk}%` } as React.CSSProperties} /></span>
            </div>
            {result.observations.length > 0 && (
              <ul className="assessment-observations">
                {result.observations.map((observation) => <li key={observation}><Check size={12} /> {observation}</li>)}
              </ul>
            )}
            <div className={`evidence-banner ${result.persisted ? 'persistent' : 'demo'}`}>
              {result.persisted ? <Database size={17} /> : <ShieldCheck size={17} />}
              <span>
                <strong>{result.persisted ? 'Persisted to CockroachDB' : result.runtime.source === 'api-demo' ? 'Ephemeral demo result' : result.runtime.apiConnected ? 'No persistence evidence' : 'Local preview only'}</strong>
                <small>{result.provider} · {result.confidence}% confidence{result.ingestionAuthority ? ` · ${result.ingestionAuthority} authoritative` : ''}{result.persisted ? '' : ' · no durable write'}</small>
              </span>
            </div>
            <div className="human-review-notice"><ShieldCheck size={15} /><span><strong>Human review required</strong><small>Imagery findings are decision support—not a forecast or authorization to deploy resources.</small></span></div>
            <button className="primary-button full" type="button" onClick={onClose}>Review updated risk zone</button>
          </div>
        ) : (
          <>
            <div className="assessment-location">
              <Satellite size={19} />
              <span><small>Assessment target</small><strong>{location.name}</strong><em>{location.county}</em></span>
            </div>

            <div className="imagery-mode" role="radiogroup" aria-label="Imagery source" onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
              event.preventDefault()
              const currentIndex = modeOrder.indexOf(mode)
              const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1
              const next = modeOrder[(currentIndex + direction + modeOrder.length) % modeOrder.length]
              setMode(next)
              setStage('select')
              setError(null)
              window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-imagery-mode="${next}"]`)?.focus())
            }}>
              <button data-imagery-mode="demo" type="button" role="radio" aria-checked={mode === 'demo'} tabIndex={mode === 'demo' ? 0 : -1} className={mode === 'demo' ? 'selected' : ''} disabled={!demoAllowed} onClick={() => { setMode('demo'); setStage('select'); setError(null) }}>
                <ImageIcon size={18} /><span><strong>Built-in demo tile</strong><small>{demoAllowed ? 'Deterministic and zero setup' : 'Disabled for persistent production'}</small></span><i />
              </button>
              <button data-imagery-mode="upload" type="button" role="radio" aria-checked={mode === 'upload'} tabIndex={mode === 'upload' ? 0 : -1} className={mode === 'upload' ? 'selected' : ''} onClick={() => { setMode('upload'); setStage('select'); setError(null) }}>
                <CloudUpload size={18} /><span><strong>Upload satellite image</strong><small>Private quarantine → GuardDuty scan</small></span><i />
              </button>
              <button data-imagery-mode="open-data" type="button" role="radio" aria-checked={mode === 'open-data'} tabIndex={mode === 'open-data' ? 0 : -1} className={mode === 'open-data' ? 'selected' : ''} onClick={() => { setMode('open-data'); setStage('select'); setError(null) }}>
                <Satellite size={18} /><span><strong>AWS Open Data</strong><small>Real Sentinel-2 L2A imagery</small></span><i />
              </button>
            </div>

            <div className="imagery-preview">
              {mode === 'demo' ? (
                <>
                  <img src="/california-terrain.png" alt="Bundled synthetic California terrain demo tile" />
                  <span className="preview-label"><ImageIcon size={13} /> Synthetic California terrain · demo input</span>
                </>
              ) : mode === 'open-data' ? (
                <div className="open-data-source">
                  <span className="open-data-icon"><Satellite size={25} /></span>
                  <div>
                    <strong>Sentinel-2 L2A true-colour scene</strong>
                    <small>Public source: s3://sentinel-s2-l2a · eu-central-1</small>
                  </div>
                  <label htmlFor="sentinel-source-key">Allowlisted R60m TCI object key</label>
                  <input
                    id="sentinel-source-key"
                    value={sourceKey}
                    onChange={(event) => { setSourceKey(event.target.value); setError(null); setStage('select') }}
                    spellCheck={false}
                    aria-invalid={!validSourceKey}
                    aria-describedby="sentinel-source-note"
                  />
                  <small id="sentinel-source-note" className="source-key-note">Verified Santa Rosa tile sample · replace the key when targeting another zone</small>
                </div>
              ) : file ? (
                <div className="selected-file-card" role="status">
                  <span className="selected-file-icon"><FileImage size={28} /></span>
                  <span>
                    <small>Selected for private quarantine</small>
                    <strong>{file.name}</strong>
                    <em>{(file.size / 1024 / 1024).toFixed(2)} MB · {file.type.replace('image/', '').toUpperCase()}</em>
                  </span>
                  <ShieldCheck size={17} aria-hidden="true" />
                </div>
              ) : (
                <label className="upload-dropzone" htmlFor={inputId} role="button" tabIndex={0} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    document.getElementById(inputId)?.click()
                  }
                }}>
                  <CloudUpload size={28} />
                  <strong>Choose source imagery</strong>
                  <small>JPEG, PNG, or WebP · max 3.5 MB</small>
                </label>
              )}
              {mode === 'upload' && (
                <input id={inputId} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectFile(event.target.files?.[0])} />
              )}
            </div>

            {mode === 'upload' && file && <button className="replace-file" type="button" onClick={() => document.getElementById(inputId)?.click()}>Replace selected image</button>}

            {busy && stage !== 'select' && stage !== 'complete' && stage !== 'error' && (
              <div className="assessment-progress" role="status" aria-live="polite">
                <RefreshCw className="spin" size={18} />
                <span><strong>{stageCopy[stage].title}</strong><small>{stage === 'assessing'
                  ? mode === 'demo' ? runtime.apiConnected ? 'Running the deterministic API assessor' : 'Running the deterministic local preview' : 'Running Bedrock only after the clean GuardDuty verdict'
                  : stageCopy[stage].detail}</small></span>
              </div>
            )}

            {error && <div id="satellite-error" className="assessment-error" role="alert">{error}</div>}

            <div className="assessment-runtime-note">
              <span className={`source-dot ${runtime.source}`} />
              <span><strong>{runtime.label}</strong><small>{mode === 'upload' ? 'Uploads use a server-authorized S3 form; GuardDuty gates every assessment.' : mode === 'open-data' ? 'The API reads only the fixed public Sentinel-2 bucket and copies the selected scene into private quarantine.' : runtime.detail}</small></span>
            </div>

            <footer>
              <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="primary-button" type="button" onClick={assess} disabled={busy || (mode === 'upload' && !file) || (mode === 'open-data' && !validSourceKey)}>
                {busy ? <RefreshCw size={16} className="spin" /> : <Satellite size={16} />}
                {busy ? 'Processing…' : mode === 'upload' ? 'Scan & assess upload' : mode === 'open-data' ? 'Import, scan & assess' : 'Assess demo tile'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

import { BrainCircuit, CheckCircle2, Database, Leaf, LockKeyhole, Satellite, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useDialogFocus } from '../lib/useDialogFocus'

interface UserGuideProps {
  open: boolean
  onClose: () => void
}

export function UserGuide({ open, onClose }: UserGuideProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(open, dialogRef)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="modal-backdrop guide-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="user-guide-modal" role="dialog" aria-modal="true" aria-labelledby="user-guide-title">
        <header>
          <div><span>Operator guide</span><h2 id="user-guide-title">Run a complete live test</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close guide" data-autofocus><X size={18} /></button>
        </header>
        <div className="guide-body">
          <ol className="guide-steps">
            <li><LockKeyhole /><span><strong>Confirm the live session</strong><small>The header must say “CockroachDB live.” If it does not, sign out and sign in again.</small></span></li>
            <li><Satellite /><span><strong>Assess evidence</strong><small>Choose Santa Rosa, select Assess imagery, and use an approved Sentinel-2 source. Review the evidence and persistence labels.</small></span></li>
            <li><BrainCircuit /><span><strong>Run the agent loop</strong><small>Select Run simulation, keep Shared memory enabled, choose a scenario, and run it. Amazon Bedrock generates the bounded plan.</small></span></li>
            <li><Database /><span><strong>Verify durable memory</strong><small>The result must show recalled memory IDs, a learned memory ID, and CockroachDB persistence. Run again to prove recall.</small></span></li>
            <li><Leaf /><span><strong>Try agricultural resilience</strong><small>After real Sentinel-2 evidence exists for the location, open Simulations and choose Agricultural resilience.</small></span></li>
          </ol>
          <aside className="guide-proof">
            <span><CheckCircle2 /> What success looks like</span>
            <ul>
              <li>Amazon Bedrock is named as the plan provider</li>
              <li>CockroachDB is named as the persistence provider</li>
              <li>The learned memory ID appears in the next run’s recall</li>
              <li>Evidence and assumptions remain visibly separated</li>
            </ul>
            <p>SentinelTwin is decision support. A human operator must review every recommendation before action.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}

import { ArrowRight, BrainCircuit, CheckCircle2, Database, Leaf, LoaderCircle, LockKeyhole, Orbit, Satellite, ShieldCheck } from 'lucide-react'

interface AccessGateProps {
  ready: boolean
  authEnabled: boolean
  error?: string
  onSignIn: () => void
}

const workflow = [
  {
    icon: Satellite,
    number: '01',
    title: 'Observe',
    detail: 'Choose a risk zone and assess an approved Sentinel-2 source. Evidence stays labeled and traceable.',
  },
  {
    icon: BrainCircuit,
    number: '02',
    title: 'Reason',
    detail: 'Run a bounded wildfire, earthquake, compound, or agricultural-resilience scenario with Amazon Bedrock.',
  },
  {
    icon: Database,
    number: '03',
    title: 'Remember',
    detail: 'Inspect recalled memory IDs and the new outcome persisted to CockroachDB for the next response.',
  },
]

export function AccessGate({ ready, authEnabled, error, onSignIn }: AccessGateProps) {
  const canSignIn = ready && authEnabled

  return (
    <main className="access-gate">
      <header className="access-nav">
        <a className="access-brand" href="#top" aria-label="SentinelTwin home">
          <span><ShieldCheck aria-hidden="true" /></span>
          Sentinel<strong>Twin</strong>
        </a>
        <span className="access-status"><i aria-hidden="true" /> Protected live system</span>
      </header>

      <section className="access-hero" id="top" aria-labelledby="access-title">
        <div className="access-hero-copy">
          <span className="access-kicker">Human-supervised agentic resilience</span>
          <h1 id="access-title">A disaster-response twin that remembers what worked.</h1>
          <p>
            SentinelTwin turns verified satellite evidence into bounded response plans, then stores each
            outcome as durable shared memory. Live data, AI reasoning, and operational actions are available
            only inside an authenticated AWS Cognito session.
          </p>
          <div className="access-actions">
            <button className="access-primary" type="button" onClick={onSignIn} disabled={!canSignIn}>
              {!ready ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}
              {!ready ? 'Checking secure access…' : authEnabled ? 'Sign in to live command center' : 'Live sign-in unavailable'}
              {canSignIn ? <ArrowRight size={18} aria-hidden="true" /> : null}
            </button>
            <span><CheckCircle2 size={15} aria-hidden="true" /> No operational data loads before sign-in</span>
          </div>
          {error ? <p className="access-error" role="alert">{error}</p> : null}
          {ready && !authEnabled && !error ? (
            <p className="access-error" role="alert">The production authentication configuration is unavailable. The command center remains locked.</p>
          ) : null}
        </div>

        <div className="access-orbit" aria-label="SentinelTwin evidence and memory loop">
          <div className="orbit-ring orbit-ring-one" />
          <div className="orbit-ring orbit-ring-two" />
          <span className="orbit-node node-satellite"><Satellite size={20} /><small>Evidence</small></span>
          <span className="orbit-node node-reason"><BrainCircuit size={20} /><small>Reason</small></span>
          <span className="orbit-node node-memory"><Database size={20} /><small>Memory</small></span>
          <div className="orbit-core"><Orbit size={30} /><strong>Observe<br />Reason<br />Remember</strong></div>
        </div>
      </section>

      <section className="access-guide" aria-labelledby="quick-start-title">
        <div className="access-guide-heading">
          <div><span>Quick start</span><h2 id="quick-start-title">How to test the live agent loop</h2></div>
          <p>Three steps take a judge from real evidence to a verifiable CockroachDB memory write.</p>
        </div>
        <ol>
          {workflow.map(({ icon: Icon, number, title, detail }) => (
            <li key={number}>
              <span className="guide-number">{number}</span>
              <Icon size={21} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="access-stack">
        <span><LockKeyhole size={15} /> Amazon Cognito access</span>
        <span><BrainCircuit size={15} /> Amazon Bedrock plans</span>
        <span><Database size={15} /> CockroachDB memory</span>
        <span><Leaf size={15} /> Evidence-gated agriculture</span>
      </footer>
    </main>
  )
}

import {
  AlertTriangle,
  Bot,
  Boxes,
  FileClock,
  FlaskConical,
  Gauge,
  Map,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import type { RuntimeContext } from '../types'

const navItems = [
  { label: 'Operations', icon: Map },
  { label: 'Situational awareness', icon: Gauge },
  { label: 'Incidents', icon: AlertTriangle },
  { label: 'Resources', icon: Boxes },
  { label: 'Plans', icon: FileClock },
  { label: 'Simulations', icon: FlaskConical },
  { label: 'Agents', icon: Bot },
]

export function Sidebar({ runtime, onUnavailable }: { runtime: RuntimeContext; onUnavailable: (feature: string) => void }) {
  const status = runtime.persistence === 'cockroachdb'
    ? { label: 'Persistent services operational', detail: 'AWS · CockroachDB', className: 'persistent' }
    : runtime.apiConnected
      ? { label: 'Demo API connected', detail: 'Ephemeral state · no durable writes', className: 'demo' }
      : { label: 'Snapshot mode active', detail: 'API offline · no cloud writes', className: 'offline' }

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="brand" aria-label="SentinelTwin home">
        <span className="brand-mark"><ShieldCheck aria-hidden="true" /></span>
        <span>Sentinel<span>Twin</span></span>
      </div>

      <nav className="primary-nav">
        {navItems.map(({ label, icon: Icon }, index) => (
          <button key={label} className={`nav-item ${index === 0 ? 'active' : ''}`} type="button" aria-current={index === 0 ? 'page' : undefined} onClick={() => index > 0 && onUnavailable(label)}>
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
        <button className="nav-item" type="button" onClick={() => onUnavailable('Settings')}>
          <Settings size={17} strokeWidth={1.7} aria-hidden="true" />
          <span>Settings</span>
        </button>
      </nav>

      <div className="system-status">
        <span>System status</span>
        <strong className={status.className}><i aria-hidden="true" /> {status.label}</strong>
        <small>{status.detail}</small>
      </div>
    </aside>
  )
}

import {
  AlertTriangle,
  Bot,
  Boxes,
  FileClock,
  FlaskConical,
  Gauge,
  Map,
  ShieldCheck,
} from 'lucide-react'
import type { RuntimeContext } from '../types'
import type { WorkspaceId } from '../types'

const navItems = [
  { id: 'operations', label: 'Operations', icon: Map },
  { id: 'awareness', label: 'Situational awareness', icon: Gauge },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'resources', label: 'Resources', icon: Boxes },
  { id: 'plans', label: 'Plans', icon: FileClock },
  { id: 'simulations', label: 'Simulations', icon: FlaskConical },
  { id: 'agents', label: 'Agents', icon: Bot },
] satisfies Array<{ id: WorkspaceId; label: string; icon: typeof Map }>

interface SidebarProps {
  runtime: RuntimeContext
  activeWorkspace: WorkspaceId
  onNavigate: (workspace: WorkspaceId) => void
}

export function Sidebar({ runtime, activeWorkspace, onNavigate }: SidebarProps) {
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
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-item ${activeWorkspace === id ? 'active' : ''}`} type="button" aria-current={activeWorkspace === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
            <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="system-status">
        <span>System status</span>
        <strong className={status.className}><i aria-hidden="true" /> {status.label}</strong>
        <small>{status.detail}</small>
      </div>
    </aside>
  )
}

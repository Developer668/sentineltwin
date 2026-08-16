import { BookOpen, ChevronDown, CloudSun, LogOut, Play, Satellite, ShieldAlert } from 'lucide-react'
import type { AuthState } from '../lib/auth'
import type { RuntimeContext } from '../types'

interface HeaderProps {
  runtime: RuntimeContext
  auth: AuthState
  workspaceLabel: string
  currentTime: string
  updatedAt: string
  onRunSimulation: () => void
  onAssessSatellite: () => void
  onAuthAction: () => void
  onGuide: () => void
}

export function Header({ runtime, auth, workspaceLabel, currentTime, updatedAt, onRunSimulation, onAssessSatellite, onAuthAction, onGuide }: HeaderProps) {
  const healthLabel = runtime.persistence === 'cockroachdb'
    ? 'Persistent memory healthy'
    : runtime.apiConnected ? 'Ephemeral demo API' : 'Snapshot mode'
  const twinLabel = runtime.persistence === 'cockroachdb' ? 'Live Twin' : runtime.apiConnected ? 'Demo Twin' : 'Snapshot'

  return (
    <header className="topbar">
      <div className="region-title">
        <CloudSun size={18} aria-hidden="true" />
        <span>{workspaceLabel}</span>
        <b>/ Western Region · {twinLabel}</b>
        <ChevronDown size={15} aria-hidden="true" />
      </div>
      <div className="topbar-actions">
        <div className={`memory-health ${runtime.source}`} title={runtime.detail} role="status">
          <i aria-hidden="true" /> {healthLabel}
        </div>
        <span className="clock">{currentTime}</span>
        <button className="guide-button" type="button" onClick={onGuide}><BookOpen size={15} /> Guide</button>
        <span className={`source-tag ${runtime.source}`} title={`Data refreshed ${new Date(updatedAt).toLocaleString()}`}>{runtime.label}</span>
        {!auth.enabled && auth.error && <span className="auth-warning" role="alert" title={auth.error}><ShieldAlert size={14} /> Auth config</span>}
        {auth.enabled && (
          <button className="auth-button" type="button" onClick={onAuthAction} title={auth.authenticated ? `Signed in${auth.userLabel ? ` as ${auth.userLabel}` : ''}` : 'Sign in with AWS Cognito'}>
            <LogOut size={14} /> Sign out
          </button>
        )}
        <button className="satellite-button" type="button" onClick={onAssessSatellite}>
          <Satellite size={16} aria-hidden="true" /> Assess imagery
        </button>
        <button className="primary-button" type="button" onClick={onRunSimulation}>
          <Play size={16} fill="currentColor" aria-hidden="true" /> Run simulation
        </button>
      </div>
    </header>
  )
}

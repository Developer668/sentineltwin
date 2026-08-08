import { Bell, ChevronDown, CircleHelp, CloudSun, LogIn, LogOut, Play, Satellite, ShieldAlert } from 'lucide-react'
import type { AuthState } from '../lib/auth'
import type { RuntimeContext } from '../types'

interface HeaderProps {
  runtime: RuntimeContext
  auth: AuthState
  currentTime: string
  updatedAt: string
  onRunSimulation: () => void
  onAssessSatellite: () => void
  onAuthAction: () => void
  onInfo: (feature: string) => void
}

export function Header({ runtime, auth, currentTime, updatedAt, onRunSimulation, onAssessSatellite, onAuthAction, onInfo }: HeaderProps) {
  const healthLabel = runtime.persistence === 'cockroachdb'
    ? 'Persistent memory healthy'
    : runtime.apiConnected ? 'Ephemeral demo API' : 'Snapshot mode'
  const twinLabel = runtime.persistence === 'cockroachdb' ? 'Live Twin' : runtime.apiConnected ? 'Demo Twin' : 'Snapshot'

  return (
    <header className="topbar">
      <div className="region-title">
        <CloudSun size={18} aria-hidden="true" />
        <span>Western Region</span>
        <b>/ {twinLabel}</b>
        <ChevronDown size={15} aria-hidden="true" />
      </div>
      <div className="topbar-actions">
        <div className={`memory-health ${runtime.source}`} title={runtime.detail} role="status">
          <i aria-hidden="true" /> {healthLabel}
        </div>
        <span className="clock">{currentTime}</span>
        <button className="icon-button" type="button" aria-label="Notifications" onClick={() => onInfo('Notifications')}><Bell size={17} /></button>
        <button className="icon-button" type="button" aria-label="Help" onClick={() => onInfo('Help')}><CircleHelp size={17} /></button>
        <span className={`source-tag ${runtime.source}`} title={`Data refreshed ${new Date(updatedAt).toLocaleString()}`}>{runtime.label}</span>
        {!auth.enabled && auth.error && <span className="auth-warning" role="alert" title={auth.error}><ShieldAlert size={14} /> Auth config</span>}
        {auth.enabled && (
          <button className="auth-button" type="button" onClick={onAuthAction} title={auth.authenticated ? `Signed in${auth.userLabel ? ` as ${auth.userLabel}` : ''}` : 'Sign in with AWS Cognito'}>
            {auth.authenticated ? <LogOut size={14} /> : <LogIn size={14} />}
            {auth.authenticated ? 'Sign out' : 'Sign in'}
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

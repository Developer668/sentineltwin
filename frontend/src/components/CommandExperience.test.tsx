import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoDashboard, offlineRuntime } from '../data/demoData'
import { Sidebar } from './Sidebar'
import { SystemWorkspace } from './SystemWorkspace'

describe('functional command-center navigation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('exposes every operational system and routes navigation instead of showing placeholder toasts', async () => {
    const onNavigate = vi.fn()
    await act(async () => root.render(
      <Sidebar runtime={offlineRuntime} activeWorkspace="operations" onNavigate={onNavigate} onUnavailable={vi.fn()} />,
    ))

    const labels = ['Operations', 'Situational awareness', 'Incidents', 'Resources', 'Plans', 'Simulations', 'Agents']
    for (const label of labels) expect(container.textContent).toContain(label)

    const incidents = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Incidents'))
    await act(async () => incidents?.click())
    expect(onNavigate).toHaveBeenCalledWith('incidents')
  })

  it('moves an incident into the situational-awareness system', async () => {
    const onSelectLocation = vi.fn()
    const onNavigate = vi.fn()
    await act(async () => root.render(
      <SystemWorkspace
        workspace="incidents"
        dashboard={structuredClone(demoDashboard)}
        runtime={offlineRuntime}
        selectedLocation={demoDashboard.locations[0]}
        layer="composite"
        planVersion="v7.3"
        outageState="idle"
        outageResult={null}
        outageError={null}
        onSelectLocation={onSelectLocation}
        onLayerChange={vi.fn()}
        onNavigate={onNavigate}
        onRunSimulation={vi.fn()}
        onAssessSatellite={vi.fn()}
        onOutage={vi.fn()}
        onRestore={vi.fn()}
        onInfo={vi.fn()}
      />,
    ))

    const openPicture = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Open picture'))
    await act(async () => openPicture?.click())
    expect(onSelectLocation).toHaveBeenCalledWith('santa-rosa')
    expect(onNavigate).toHaveBeenCalledWith('awareness')
  })

  it('opens the correct bounded simulation preset', async () => {
    const onRunSimulation = vi.fn()
    await act(async () => root.render(
      <SystemWorkspace
        workspace="simulations"
        dashboard={structuredClone(demoDashboard)}
        runtime={offlineRuntime}
        selectedLocation={demoDashboard.locations[0]}
        layer="composite"
        planVersion="v7.3"
        outageState="idle"
        outageResult={null}
        outageError={null}
        onSelectLocation={vi.fn()}
        onLayerChange={vi.fn()}
        onNavigate={vi.fn()}
        onRunSimulation={onRunSimulation}
        onAssessSatellite={vi.fn()}
        onOutage={vi.fn()}
        onRestore={vi.fn()}
        onInfo={vi.fn()}
      />,
    ))

    const compound = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Compound cascade'))
    await act(async () => compound?.click())
    expect(onRunSimulation).toHaveBeenCalledWith('composite')
  })
})

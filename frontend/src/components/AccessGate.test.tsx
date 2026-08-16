import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessGate } from './AccessGate'

describe('secure access gate', () => {
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

  it('explains the workflow without exposing operational controls', async () => {
    await act(async () => root.render(<AccessGate ready authEnabled onSignIn={vi.fn()} />))

    expect(container.textContent).toContain('How to test the live agent loop')
    expect(container.textContent).toContain('Sign in to live command center')
    expect(container.textContent).not.toContain('Run simulation')
    expect(container.textContent).not.toContain('Assess imagery')
  })

  it('starts Cognito sign-in only from the enabled gate', async () => {
    const onSignIn = vi.fn()
    await act(async () => root.render(<AccessGate ready authEnabled onSignIn={onSignIn} />))
    const button = container.querySelector('button')
    expect(button?.disabled).toBe(false)
    await act(async () => button?.click())
    expect(onSignIn).toHaveBeenCalledOnce()
  })

  it('fails closed when production authentication is unavailable', async () => {
    await act(async () => root.render(<AccessGate ready authEnabled={false} onSignIn={vi.fn()} />))
    expect(container.querySelector('button')?.disabled).toBe(true)
    expect(container.textContent).toContain('command center remains locked')
  })
})

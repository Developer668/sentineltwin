import { afterEach, describe, expect, it, vi } from 'vitest'
import { sentinelApi } from './api'
import { cognitoAuth } from './auth'

function enableCognito() {
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'https://sentineltwin.auth.us-west-2.amazoncognito.com')
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'publicspaclient')
  vi.stubEnv('VITE_COGNITO_REDIRECT_URI', `${window.location.origin}/`)
}

function jwt(claims: Record<string, unknown>) {
  const payload = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `header.${payload}.signature`
}

describe('Cognito PKCE session handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    cognitoAuth.signOut()
    vi.useRealTimers()
    sessionStorage.clear()
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('keeps local and public mode enabled when Cognito is not configured', () => {
    expect(cognitoAuth.state()).toEqual({ enabled: false, authenticated: false, userLabel: undefined, error: undefined })
  })

  it('rejects a callback whose state does not match before contacting the token endpoint', async () => {
    enableCognito()
    sessionStorage.setItem('sentineltwin.auth.verifier', 'pkce-verifier')
    sessionStorage.setItem('sentineltwin.auth.state', 'expected-state')
    window.history.replaceState({}, '', '/?code=authorization-code&state=wrong-state')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const state = await cognitoAuth.completeCallback()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(state).toMatchObject({ enabled: true, authenticated: false, error: expect.stringContaining('could not be verified') })
    expect(window.location.search).toBe('')
    expect(sessionStorage.getItem('sentineltwin.auth.verifier')).toBeNull()
  })

  it('keeps tokens only in module memory while attaching the bearer in the same page lifetime', async () => {
    enableCognito()
    sessionStorage.setItem('sentineltwin.auth.verifier', 'pkce-verifier')
    sessionStorage.setItem('sentineltwin.auth.state', 'verified-state')
    window.history.replaceState({}, '', '/?code=authorization-code&state=verified-state')
    const idToken = jwt({ email: 'operator@example.com', token_use: 'id', aud: 'publicspaclient' })
    const accessToken = jwt({ token_use: 'access', client_id: 'publicspaclient' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: accessToken, id_token: idToken, refresh_token: 'must-not-be-stored', expires_in: 3600, token_type: 'Bearer' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { locations: [{ id: 'loc-1', name: 'Test zone', region: 'California', latitude: 38, longitude: -122, fire_risk: .7, earthquake_risk: .5, status: 'high' }] },
          meta: { mode: 'demo', memory_provider: 'deterministic-in-memory' },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const state = await cognitoAuth.completeCallback()
    await sentinelApi.getDashboard()

    expect(state).toMatchObject({ enabled: true, authenticated: true, userLabel: 'operator@example.com' })
    expect(cognitoAuth.getAccessToken()).toBe(accessToken)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${accessToken}`)
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
    expect(window.location.search).toBe('')
  })

  it('clears an expired in-memory access token and forces a fresh sign-in', async () => {
    enableCognito()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-08T00:00:00Z'))
    sessionStorage.setItem('sentineltwin.auth.verifier', 'pkce-verifier')
    sessionStorage.setItem('sentineltwin.auth.state', 'verified-state')
    window.history.replaceState({}, '', '/?code=authorization-code&state=verified-state')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: jwt({ token_use: 'access', client_id: 'publicspaclient' }),
        expires_in: 60,
        token_type: 'Bearer',
      }),
    }))

    expect((await cognitoAuth.completeCallback()).authenticated).toBe(true)
    vi.setSystemTime(new Date('2026-08-08T00:01:01Z'))

    expect(cognitoAuth.state().authenticated).toBe(false)
    expect(cognitoAuth.getAccessToken()).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('rejects non-HTTPS Cognito domains outside loopback development', () => {
    vi.stubEnv('VITE_COGNITO_DOMAIN', 'http://auth.example.com')
    vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'publicspaclient')

    expect(cognitoAuth.state()).toMatchObject({
      enabled: false,
      authenticated: false,
      error: 'Cognito domain must use HTTPS outside localhost development.',
    })
  })

  it('rejects a cross-origin redirect URI before starting sign-in', () => {
    enableCognito()
    vi.stubEnv('VITE_COGNITO_REDIRECT_URI', 'https://attacker.example/callback')

    expect(cognitoAuth.state()).toMatchObject({
      enabled: false,
      authenticated: false,
      error: 'Cognito redirect URI must be a same-origin URL without credentials or parameters.',
    })
  })

  it('rejects unapproved OAuth scopes', () => {
    enableCognito()
    vi.stubEnv('VITE_COGNITO_SCOPES', 'openid email aws.cognito.signin.user.admin')

    expect(cognitoAuth.state()).toMatchObject({
      enabled: false,
      error: expect.stringContaining('may contain only'),
    })
  })

  it('rejects token responses with the wrong client or token type', async () => {
    enableCognito()
    sessionStorage.setItem('sentineltwin.auth.verifier', 'pkce-verifier')
    sessionStorage.setItem('sentineltwin.auth.state', 'verified-state')
    window.history.replaceState({}, '', '/?code=authorization-code&state=verified-state')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: jwt({ token_use: 'access', client_id: 'different-client' }),
        expires_in: 3600,
        token_type: 'DPoP',
      }),
    }))

    expect(await cognitoAuth.completeCallback()).toMatchObject({
      authenticated: false,
      error: expect.stringContaining('secure token exchange'),
    })
    expect(cognitoAuth.getAccessToken()).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })
})

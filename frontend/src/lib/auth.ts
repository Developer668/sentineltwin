export interface AuthState {
  enabled: boolean
  authenticated: boolean
  userLabel?: string
  error?: string
}

type TokenResponse = {
  access_token: string
  id_token?: string
  expires_in?: number
  token_type?: string
}

const storageKeys = {
  verifier: 'sentineltwin.auth.verifier',
  state: 'sentineltwin.auth.state',
}

let memoryAccessToken: string | null = null
let memoryIdToken: string | null = null
let memoryExpiresAt = 0

function normalizedDomain(): { domain: string; error?: string } {
  const value = (import.meta.env.VITE_COGNITO_DOMAIN as string | undefined)?.trim().replace(/\/$/, '') ?? ''
  if (!value) return { domain: '' }
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      return { domain: '', error: 'Cognito domain must use HTTPS outside localhost development.' }
    }
    return { domain: url.origin }
  } catch {
    return { domain: '', error: 'Cognito domain is not a valid HTTPS URL.' }
  }
}

function redirectUri(): string {
  return (import.meta.env.VITE_COGNITO_REDIRECT_URI as string | undefined)?.trim() || `${window.location.origin}/`
}

function config() {
  const domain = normalizedDomain()
  return {
    domain: domain.domain,
    domainError: domain.error,
    clientId: (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined)?.trim() ?? '',
    redirectUri: redirectUri(),
    scopes: (import.meta.env.VITE_COGNITO_SCOPES as string | undefined)?.trim() || 'openid email profile',
  }
}

function randomUrlSafe(byteLength = 48): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return base64Url(bytes)
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

function decodeClaims(token?: string): Record<string, unknown> {
  if (!token) return {}
  try {
    const payload = token.split('.')[1]
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function currentState(error?: string): AuthState {
  const { domain, clientId, domainError } = config()
  const enabled = Boolean(domain && clientId)
  if (memoryAccessToken && memoryExpiresAt <= Date.now() + 15_000) {
    clearTokens()
  }
  const authenticated = Boolean(enabled && memoryAccessToken && memoryExpiresAt > Date.now() + 15_000)
  const claims = decodeClaims(memoryIdToken ?? undefined)
  const userLabel = String(claims.email ?? claims['cognito:username'] ?? claims.username ?? '').trim() || undefined
  return { enabled, authenticated, userLabel, error: error ?? domainError }
}

function clearTransient(): void {
  sessionStorage.removeItem(storageKeys.verifier)
  sessionStorage.removeItem(storageKeys.state)
}

function clearTokens(): void {
  memoryAccessToken = null
  memoryIdToken = null
  memoryExpiresAt = 0
}

function cleanCallbackUrl(): void {
  const url = new URL(window.location.href)
  for (const key of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(key)
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
}

export const cognitoAuth = {
  state(): AuthState {
    return currentState()
  },

  getAccessToken(): string | null {
    const state = currentState()
    return state.authenticated ? memoryAccessToken : null
  },

  async beginSignIn(): Promise<void> {
    const { domain, clientId, redirectUri: callback, scopes } = config()
    if (!domain || !clientId) return
    const verifier = randomUrlSafe(64)
    const state = randomUrlSafe(32)
    sessionStorage.setItem(storageKeys.verifier, verifier)
    sessionStorage.setItem(storageKeys.state, state)
    const url = new URL(`${domain}/oauth2/authorize`)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: callback,
      scope: scopes,
      state,
      code_challenge_method: 'S256',
      code_challenge: await challengeFor(verifier),
    }).toString()
    window.location.assign(url)
  },

  async completeCallback(): Promise<AuthState> {
    const url = new URL(window.location.href)
    const authError = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    if (authError) {
      const message = url.searchParams.get('error_description') || authError
      clearTransient()
      cleanCallbackUrl()
      return currentState(`Sign-in was not completed: ${message}`)
    }
    if (!code) return currentState()

    const returnedState = url.searchParams.get('state')
    const expectedState = sessionStorage.getItem(storageKeys.state)
    const verifier = sessionStorage.getItem(storageKeys.verifier)
    const { domain, clientId, redirectUri: callback } = config()
    if (!domain || !clientId || !verifier || !expectedState || returnedState !== expectedState) {
      clearTransient()
      cleanCallbackUrl()
      return currentState('Sign-in response could not be verified. Please try again.')
    }

    try {
      const response = await fetch(`${domain}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: callback,
          code_verifier: verifier,
        }),
      })
      if (!response.ok) throw new Error(`token endpoint returned ${response.status}`)
      const tokens = await response.json() as TokenResponse
      if (!tokens.access_token) throw new Error('access token missing')
      memoryAccessToken = tokens.access_token
      memoryIdToken = tokens.id_token ?? null
      memoryExpiresAt = Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000
      cleanCallbackUrl()
      return currentState()
    } catch {
      clearTokens()
      cleanCallbackUrl()
      return currentState('Cognito sign-in failed during the secure token exchange.')
    } finally {
      clearTransient()
    }
  },

  signOut(): void {
    const { domain, clientId } = config()
    clearTransient()
    clearTokens()
    if (!domain || !clientId) return
    const url = new URL(`${domain}/logout`)
    url.search = new URLSearchParams({ client_id: clientId, logout_uri: `${window.location.origin}/` }).toString()
    window.location.assign(url)
  },
}

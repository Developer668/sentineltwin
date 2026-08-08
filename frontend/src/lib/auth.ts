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
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return { domain: '', error: 'Cognito domain must be an origin without credentials, paths, or parameters.' }
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      return { domain: '', error: 'Cognito domain must use HTTPS outside localhost development.' }
    }
    return { domain: url.origin }
  } catch {
    return { domain: '', error: 'Cognito domain is not a valid HTTPS URL.' }
  }
}

function normalizedRedirectUri(): { redirectUri: string; error?: string } {
  const value = (import.meta.env.VITE_COGNITO_REDIRECT_URI as string | undefined)?.trim() || `${window.location.origin}/`
  try {
    const url = new URL(value)
    if (url.origin !== window.location.origin || url.username || url.password || url.search || url.hash) {
      return { redirectUri: '', error: 'Cognito redirect URI must be a same-origin URL without credentials or parameters.' }
    }
    return { redirectUri: url.href }
  } catch {
    return { redirectUri: '', error: 'Cognito redirect URI is not a valid same-origin URL.' }
  }
}

function normalizedScopes(): { scopes: string; error?: string } {
  const value = (import.meta.env.VITE_COGNITO_SCOPES as string | undefined)?.trim() || 'openid email profile'
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))]
  const allowed = new Set(['openid', 'email', 'profile'])
  if (!scopes.includes('openid') || scopes.some((scope) => !allowed.has(scope))) {
    return { scopes: '', error: 'Cognito scopes must include openid and may contain only openid, email, and profile.' }
  }
  return { scopes: scopes.join(' ') }
}

function config() {
  const domain = normalizedDomain()
  const redirect = normalizedRedirectUri()
  const scopes = normalizedScopes()
  const clientId = (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined)?.trim() ?? ''
  const clientError = clientId && !/^[A-Za-z0-9]{1,128}$/.test(clientId)
    ? 'Cognito client ID contains unsupported characters.'
    : undefined
  return {
    domain: domain.domain,
    configError: domain.error ?? redirect.error ?? scopes.error ?? clientError,
    clientId: clientError ? '' : clientId,
    redirectUri: redirect.redirectUri,
    scopes: scopes.scopes,
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
  const { domain, clientId, redirectUri, scopes, configError } = config()
  const enabled = Boolean(domain && clientId && redirectUri && scopes && !configError)
  if (memoryAccessToken && memoryExpiresAt <= Date.now() + 15_000) {
    clearTokens()
  }
  const authenticated = Boolean(enabled && memoryAccessToken && memoryExpiresAt > Date.now() + 15_000)
  const claims = decodeClaims(memoryIdToken ?? undefined)
  const userLabel = String(claims.email ?? claims['cognito:username'] ?? claims.username ?? '').trim() || undefined
  return { enabled, authenticated, userLabel, error: error ?? configError }
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
      const message = (url.searchParams.get('error_description') || authError).slice(0, 180)
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
      const expiresIn = Number(tokens.expires_in)
      const accessClaims = decodeClaims(tokens.access_token)
      if (!tokens.access_token || tokens.access_token.split('.').length !== 3) throw new Error('access token missing')
      if (tokens.token_type?.toLowerCase() !== 'bearer') throw new Error('unexpected token type')
      if (!Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 86_400) throw new Error('invalid token lifetime')
      if (accessClaims.token_use !== 'access' || accessClaims.client_id !== clientId) throw new Error('unexpected access token claims')
      memoryAccessToken = tokens.access_token
      memoryIdToken = tokens.id_token ?? null
      memoryExpiresAt = Date.now() + expiresIn * 1000
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

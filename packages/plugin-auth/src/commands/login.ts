import type {OAuthCallback} from '../callback'

import {AuthLoginCommand} from '@datadog/datadog-ci-base/commands/auth/login'
import {isRequestError} from '@datadog/datadog-ci-base/helpers/request'

import {readManualCallback, startCallbackServer, withTimeout} from '../callback'
import {openBrowser, shouldOpenBrowser} from '../environment'
import {
  buildAuthorizationUrl,
  createPKCE,
  createState,
  exchangeAuthorizationCode,
  getCurrentUser,
  getRedirectUri,
  normalizeScopes,
  registerClient,
  resolveSite,
} from '../oauth'
import {saveOAuthSession} from '../storage'

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const formatError = (error: unknown): string => {
  if (isRequestError(error)) {
    const data = error.response?.data
    const detail = data?.errors?.[0]?.detail || data?.errors?.[0] || data?.error_description || data?.error

    return detail
      ? `Datadog OAuth request failed: ${String(detail)}`
      : `Datadog OAuth request failed (${error.response?.status || 'network error'}).`
  }

  return error instanceof Error ? error.message : String(error)
}

export class PluginCommand extends AuthLoginCommand {
  public async execute(): Promise<number> {
    let callbackServer: Awaited<ReturnType<typeof startCallbackServer>> | undefined
    try {
      const site = resolveSite(this.site)
      const scopes = normalizeScopes(this.scopes)
      const callbackPort = this.callbackPort === undefined ? undefined : Number(this.callbackPort)
      const state = createState()
      const pkce = createPKCE()
      callbackServer = await startCallbackServer(state, callbackPort)
      const redirectUri = getRedirectUri(callbackServer.port)
      const clientId = await registerClient(site, redirectUri)
      const authorizationUrl = buildAuthorizationUrl({
        challenge: pkce.challenge,
        clientId,
        redirectUri,
        scopes,
        site,
        state,
      })

      const preference = this.browser === true ? 'always' : this.browser === false ? 'never' : 'auto'
      let manual = !shouldOpenBrowser(preference)
      if (!manual) {
        try {
          await openBrowser(authorizationUrl)
          this.context.stdout.write('Opened Datadog in your browser. Complete authorization to continue.\n')
        } catch {
          manual = true
          this.context.stderr.write('Could not open a browser; switching to manual login.\n')
        }
      }

      let callbackPromise = callbackServer.callback
      let manualController: AbortController | undefined
      if (manual) {
        this.context.stdout.write(
          `Open this URL in a browser:\n\n${authorizationUrl}\n\nThe localhost page may fail to load. Copy its complete URL from the address bar and paste it here.\nPaste the complete redirect URL: `
        )
        manualController = new AbortController()
        callbackPromise = Promise.race([
          callbackPromise,
          readManualCallback(this.context.stdin, this.context.stdout, state, manualController.signal),
        ])
      }

      let callback: OAuthCallback
      try {
        callback = await withTimeout(callbackPromise, LOGIN_TIMEOUT_MS)
      } finally {
        manualController?.abort()
      }
      const effectiveSite = callback.domain ? resolveSite(callback.domain) : site
      const tokens = await exchangeAuthorizationCode({
        clientId,
        code: callback.code,
        redirectUri,
        site: effectiveSite,
        verifier: pkce.verifier,
      })
      const user = await getCurrentUser(effectiveSite, tokens.accessToken)
      await saveOAuthSession(
        {
          accessToken: tokens.accessToken,
          clientId,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          refreshToken: tokens.refreshToken,
          scopes: tokens.scope,
          site: effectiveSite,
          tokenType: tokens.tokenType,
          user,
        },
        (message) => this.context.stderr.write(`${message}\n`)
      )
      const identity = user.email || user.name || 'your Datadog account'
      this.context.stdout.write(`Authenticated as ${identity} on ${effectiveSite}.\n`)

      return 0
    } catch (error) {
      this.context.stderr.write(`Authentication failed: ${formatError(error)}\n`)

      return 1
    } finally {
      await callbackServer?.close()
    }
  }
}

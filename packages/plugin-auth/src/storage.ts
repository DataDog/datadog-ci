import {randomUUID} from 'node:crypto'
import {chmod, mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {refreshAccessToken} from './oauth'

export interface OAuthSession {
  accessToken: string
  clientId: string
  expiresAt: number
  refreshToken: string
  scopes: string[]
  site: string
  tokenType: string
  user?: {email?: string; name?: string}
}

interface KeyringEntry {
  deletePassword(): void
  getPassword(): string | null
  setPassword(password: string): void
}

type EntryConstructor = new (service: string, account: string) => KeyringEntry

const KEYRING_SERVICE = 'datadog-ci'
const KEYRING_ACCOUNT = 'oauth-session'
const KEYRING_CHUNK_SIZE = 2400
const MANIFEST_VERSION = 1

const getConfigFile = (env = process.env, platform = process.platform): string => {
  if (platform === 'win32') {
    const appData = env.APPDATA
    if (!appData) {
      throw new Error('APPDATA is not set; cannot locate the Datadog CLI configuration directory.')
    }

    return path.join(appData, 'datadog-ci', 'oauth.json')
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'datadog-ci', 'oauth.json')
  }

  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'datadog-ci', 'oauth.json')
}

const validateSession = (value: unknown): OAuthSession => {
  const session = value as Partial<OAuthSession>
  if (
    !session ||
    typeof session.accessToken !== 'string' ||
    typeof session.clientId !== 'string' ||
    typeof session.expiresAt !== 'number' ||
    typeof session.refreshToken !== 'string' ||
    !Array.isArray(session.scopes) ||
    typeof session.site !== 'string' ||
    typeof session.tokenType !== 'string'
  ) {
    throw new Error('Stored OAuth session is corrupt or incomplete. Run datadog-ci auth login again.')
  }

  return session as OAuthSession
}

const parseSession = (serialized: string): OAuthSession => {
  try {
    return validateSession(JSON.parse(serialized))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Stored OAuth session')) {
      throw error
    }
    throw new Error('Stored OAuth session is corrupt or incomplete. Run datadog-ci auth login again.')
  }
}

const loadKeyring = async (): Promise<EntryConstructor | undefined> => {
  try {
    const module = await import('@napi-rs/keyring')

    return module.Entry as EntryConstructor
  } catch {
    return undefined
  }
}

const loadFromKeyring = async (): Promise<OAuthSession | undefined> => {
  const Entry = await loadKeyring()
  if (!Entry) {
    return undefined
  }
  let manifest: string | null
  try {
    manifest = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT).getPassword()
  } catch {
    return undefined
  }
  if (!manifest) {
    return undefined
  }
  let chunks: number
  let generation: string
  try {
    const parsed = JSON.parse(manifest) as {chunks?: unknown; generation?: unknown; version?: unknown}
    if (
      parsed.version !== MANIFEST_VERSION ||
      typeof parsed.generation !== 'string' ||
      !Number.isInteger(parsed.chunks) ||
      Number(parsed.chunks) < 1
    ) {
      throw new Error()
    }
    chunks = Number(parsed.chunks)
    generation = parsed.generation
  } catch {
    throw new Error('Stored OAuth keychain manifest is corrupt. Run datadog-ci auth login again.')
  }

  let serialized = ''
  for (let index = 0; index < chunks; index++) {
    const chunk = new Entry(KEYRING_SERVICE, `${KEYRING_ACCOUNT}:${generation}:${index}`).getPassword()
    if (!chunk) {
      throw new Error('Stored OAuth keychain session is incomplete. Run datadog-ci auth login again.')
    }
    serialized += chunk
  }

  return parseSession(serialized)
}

const saveToKeyring = async (serialized: string): Promise<boolean> => {
  const Entry = await loadKeyring()
  if (!Entry) {
    return false
  }
  try {
    const chunks = serialized.match(new RegExp(`.{1,${KEYRING_CHUNK_SIZE}}`, 'gs')) || []
    const manifestEntry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT)
    let previousChunks = 0
    let previousGeneration: string | undefined
    const oldManifest = manifestEntry.getPassword()
    if (oldManifest) {
      try {
        const parsed = JSON.parse(oldManifest) as {chunks?: number; generation?: string}
        previousChunks = Number(parsed.chunks) || 0
        previousGeneration = parsed.generation
      } catch {
        previousChunks = 0
      }
    }
    const generation = randomUUID()
    chunks.forEach((chunk, index) =>
      new Entry(KEYRING_SERVICE, `${KEYRING_ACCOUNT}:${generation}:${index}`).setPassword(chunk)
    )
    manifestEntry.setPassword(JSON.stringify({chunks: chunks.length, generation, version: MANIFEST_VERSION}))
    if (previousGeneration) {
      for (let index = 0; index < previousChunks; index++) {
        new Entry(KEYRING_SERVICE, `${KEYRING_ACCOUNT}:${previousGeneration}:${index}`).deletePassword()
      }
    }

    return true
  } catch {
    return false
  }
}

const loadFromFile = async (): Promise<OAuthSession | undefined> => {
  const file = getConfigFile()
  try {
    return parseSession(await readFile(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

const saveToFile = async (serialized: string) => {
  const file = getConfigFile()
  const directory = path.dirname(file)
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  await mkdir(directory, {mode: 0o700, recursive: true})
  if (process.platform !== 'win32') {
    await chmod(directory, 0o700)
  }
  try {
    await writeFile(temporary, serialized, {encoding: 'utf8', mode: 0o600})
    if (process.platform !== 'win32') {
      await chmod(temporary, 0o600)
    }
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

export const loadOAuthSession = async (): Promise<OAuthSession | undefined> =>
  (await loadFromKeyring()) || loadFromFile()

export const saveOAuthSession = async (
  session: OAuthSession,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`)
): Promise<void> => {
  const serialized = JSON.stringify(validateSession(session))
  if (await saveToKeyring(serialized)) {
    return
  }
  warn('The operating system keychain is unavailable; storing the OAuth session in the protected config file instead.')
  await saveToFile(serialized)
}

export const getValidOAuthAccessToken = async (): Promise<string> => {
  const session = await loadOAuthSession()
  if (!session) {
    throw new Error('No OAuth session found. Run datadog-ci auth login first.')
  }
  if (session.expiresAt - Date.now() > 5 * 60 * 1000) {
    return session.accessToken
  }
  const tokens = await refreshAccessToken(session)
  const refreshed: OAuthSession = {
    ...session,
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    refreshToken: tokens.refreshToken,
    scopes: tokens.scope,
    tokenType: tokens.tokenType,
  }
  await saveOAuthSession(refreshed)

  return refreshed.accessToken
}

export const storageInternals = {getConfigFile, parseSession}

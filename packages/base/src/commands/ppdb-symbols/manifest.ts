import fs from 'fs'

// Assembly name (without extension) -> debug ID (hex GUID + age), as produced by
// dd-sdk-maui's build-time debug ID manifest generator (dd_debug_ids.json).
export type DebugIdManifest = Record<string, string>

export const readDebugIdManifest = (manifestPath: string): DebugIdManifest => {
  const content = fs.readFileSync(manifestPath, 'utf8')
  const parsed: unknown = JSON.parse(content)

  if (typeof parsed !== 'object' || !parsed || Array.isArray(parsed)) {
    throw new Error(`Debug ID manifest ${manifestPath} is not a JSON object`)
  }

  for (const [assemblyName, debugId] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof debugId !== 'string') {
      throw new Error(`Debug ID manifest ${manifestPath} has a non-string debug ID for assembly "${assemblyName}"`)
    }
  }

  return parsed as DebugIdManifest
}

export class AmbiguousManifestEntryError extends Error {
  constructor(
    public readonly assemblyName: string,
    public readonly matchingKeys: string[]
  ) {
    super(
      `Debug ID manifest has multiple entries matching assembly "${assemblyName}" case-insensitively ` +
        `(${matchingKeys.join(', ')}) with different debug IDs`
    )
  }
}

// Assembly names are effectively case-insensitive (Windows file systems, .NET simple-name resolution),
// so an exact-case manifest key mismatch shouldn't cause a real first-party assembly to be skipped.
export const lookupDebugId = (manifest: DebugIdManifest, assemblyName: string): string | undefined => {
  if (assemblyName in manifest) {
    return manifest[assemblyName]
  }

  const lowerAssemblyName = assemblyName.toLowerCase()
  const matchingKeys = Object.keys(manifest).filter((key) => key.toLowerCase() === lowerAssemblyName)

  if (matchingKeys.length === 0) {
    return undefined
  }

  const distinctDebugIds = new Set(matchingKeys.map((key) => manifest[key]))
  if (distinctDebugIds.size > 1) {
    throw new AmbiguousManifestEntryError(assemblyName, matchingKeys)
  }

  return manifest[matchingKeys[0]]
}

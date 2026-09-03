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

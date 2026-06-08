import fs from 'fs'
// eslint-disable-next-line no-restricted-imports
import path from 'path'

const ROOT = path.resolve(__dirname, '..')

// Files too cross-cutting to attribute to a single scope
const SKIP_HELPERS = new Set([
  path.join(ROOT, 'packages/base/src/helpers/apikey.ts'),
  path.join(ROOT, 'packages/base/src/helpers/upload.ts'),
])

const FLARE_HELPER = path.join(ROOT, 'packages/base/src/helpers/serverless/flare.ts')

type Row = {scope: string; route: string; method: string}

const collectTsFiles = (dir: string): string[] => {
  if (!fs.existsSync(dir)) {
    return []
  }
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === '__tests__') {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full)
    }
  }

  return results
}

const extractRoutes = (filePath: string): {route: string; method: string}[] => {
  if (SKIP_HELPERS.has(filePath)) {
    return []
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  const results: {route: string; method: string}[] = []

  const routeRegex = /datadogRoute\('([^']+)'/g
  const methodRegex = /method:\s*(?:'(GET|POST|PUT|DELETE|PATCH)'|METHOD_(GET|POST|PUT|DELETE|PATCH))/i

  let match: RegExpExecArray | undefined
  while ((match = routeRegex.exec(content) ?? undefined) !== undefined) {
    const route = match[1]
    // Determine line number of this match (0-indexed)
    const before = content.slice(0, match.index)
    const lineIndex = before.split('\n').length - 1

    // Look up to 5 lines back and 2 lines forward for method
    let method = 'GET'
    const startLine = Math.max(0, lineIndex - 5)
    const endLine = Math.min(lines.length - 1, lineIndex + 2)
    const searchLines = [
      ...Array.from({length: lineIndex - startLine + 1}, (_, k) => lineIndex - k),
      ...Array.from({length: endLine - lineIndex}, (_, k) => lineIndex + k + 1),
    ]
    for (const i of searchLines) {
      const m = methodRegex.exec(lines[i])
      if (m) {
        method = (m[1] ?? m[2]).toUpperCase()
        break
      }
    }

    results.push({route, method})
  }

  return results
}

const collectScopeEntries = (): Map<string, string[]> => {
  const scopes = new Map<string, string[]>()

  // Plugin packages: packages/plugin-<scope>/src/**/*.ts
  const packagesDir = path.join(ROOT, 'packages')
  for (const entry of fs.readdirSync(packagesDir, {withFileTypes: true})) {
    if (entry.isDirectory() && entry.name.startsWith('plugin-')) {
      const scope = entry.name.slice('plugin-'.length)
      const files = collectTsFiles(path.join(packagesDir, entry.name, 'src'))
      scopes.set(scope, files)
    }
  }

  // Base command scopes: packages/base/src/commands/<scope>/
  const commandsDir = path.join(ROOT, 'packages/base/src/commands')
  for (const entry of fs.readdirSync(commandsDir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      const scope = entry.name
      const files = collectTsFiles(path.join(commandsDir, scope))
      const existing = scopes.get(scope) ?? []
      scopes.set(scope, [...existing, ...files])
    }
  }

  return scopes
}

const findFlareScopeImporters = (scopes: Map<string, string[]>): Set<string> => {
  const importers = new Set<string>()
  for (const [scope, files] of scopes) {
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8')
      if (content.includes('helpers/serverless/flare')) {
        importers.add(scope)
        break
      }
    }
  }

  return importers
}

const main = () => {
  const scopes = collectScopeEntries()

  // Determine which scopes import the shared flare helper
  const flareImporters = findFlareScopeImporters(scopes)
  const flareRoutes = extractRoutes(FLARE_HELPER)

  const rows: Row[] = []

  for (const [scope, files] of scopes) {
    for (const f of files) {
      for (const {route, method} of extractRoutes(f)) {
        rows.push({scope, route, method})
      }
    }
    // Attribute flare routes to any scope that imports the helper
    if (flareImporters.has(scope)) {
      for (const {route, method} of flareRoutes) {
        rows.push({scope, route, method})
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  const unique = rows.filter(({scope, route, method}) => {
    const key = `${scope}|${route}|${method}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)

    return true
  })

  // Sort by scope then route
  unique.sort((a, b) => {
    const s = a.scope.localeCompare(b.scope)

    return s !== 0 ? s : a.route.localeCompare(b.route)
  })

  const csv = ['scope,route,method', ...unique.map(({scope, route, method}) => `${scope},${route},${method}`)].join(
    '\n'
  )

  const outPath = path.join(ROOT, 'endpoints.csv')
  fs.writeFileSync(outPath, csv + '\n')
  console.log(`Wrote ${unique.length} rows to ${outPath}`)
}

main()

import fs from 'fs'
// eslint-disable-next-line no-restricted-imports
import path from 'path'

const ROOT = path.resolve(__dirname, '..')

// Files too cross-cutting to attribute to a single scope
const SKIP_HELPERS = new Set([
  path.join(ROOT, 'packages/base/src/helpers/apikey.ts'),
  path.join(ROOT, 'packages/base/src/helpers/upload.ts'),
])

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
  const methodRegex = /method:\s*(?:'(GET|POST|PUT|DELETE|PATCH)')/

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
        method = m[1].toUpperCase()
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

// For a helper file, find all scopes that import it
const findHelperImporters = (scopes: Map<string, string[]>, helperFile: string): Set<string> => {
  const importers = new Set<string>()
  const srcDir = path.join(ROOT, 'packages/base/src')
  const relPath = path.relative(srcDir, helperFile).replace(/\.ts$/, '').replace(/\\/g, '/')
  for (const [scope, files] of scopes) {
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8')
      if (content.includes(relPath)) {
        importers.add(scope)
        break
      }
    }
  }

  return importers
}

const main = () => {
  const scopes = collectScopeEntries()
  const rowMap = new Map<string, Row>()

  const addRow = (scope: string, route: string, method: string) => {
    rowMap.set(`${scope}|${route}|${method}`, {scope, route, method})
  }

  for (const [scope, files] of scopes) {
    for (const f of files) {
      for (const {route, method} of extractRoutes(f)) {
        addRow(scope, route, method)
      }
    }
  }

  // Attribute shared helper routes to all scopes that import them
  const helpersDir = path.join(ROOT, 'packages/base/src/helpers')
  for (const helperFile of collectTsFiles(helpersDir)) {
    if (SKIP_HELPERS.has(helperFile)) {
      continue
    }
    const helperRoutes = extractRoutes(helperFile)
    if (helperRoutes.length === 0) {
      continue
    }
    const importers = findHelperImporters(scopes, helperFile)
    for (const scope of importers) {
      for (const {route, method} of helperRoutes) {
        addRow(scope, route, method)
      }
    }
  }

  // Sort by scope then route
  const rows = [...rowMap.values()].sort((a, b) => {
    const s = a.scope.localeCompare(b.scope)

    return s !== 0 ? s : a.route.localeCompare(b.route)
  })

  const csv = [
    'resource_name,scope,route,method',
    ...rows.map(({scope, route, method}) => `${method} ${route},${scope},${route},${method}`),
  ].join('\n')

  const outPath = path.join(ROOT, 'endpoints.csv')
  fs.writeFileSync(outPath, csv + '\n')
  console.log(`Wrote ${rows.length} rows to ${outPath}`)
}

main()

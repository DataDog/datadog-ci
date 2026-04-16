import fs from 'node:fs'
import path from 'node:path'

const packageInfoCache = new Map()

const findPackageInfo = (startDir) => {
  const visited = []
  let dir = startDir
  while (true) {
    if (packageInfoCache.has(dir)) {
      const cached = packageInfoCache.get(dir)
      for (const d of visited) packageInfoCache.set(d, cached)
      return cached
    }
    visited.push(dir)
    const pkgJsonPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
        if (pkg.name) {
          const result = {name: pkg.name, dir, exports: pkg.exports ?? {}}
          for (const d of visited) packageInfoCache.set(d, result)
          return result
        }
      } catch {}
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      for (const d of visited) packageInfoCache.set(d, null)
      return null
    }
    dir = parent
  }
}

const resolveExportSubpath = (exports, pkgDir, subpath) => {
  for (const [pattern, value] of Object.entries(exports)) {
    let template = null
    if (pattern === subpath) {
      template = typeof value === 'string' ? value : (value?.development ?? value?.default ?? null)
    } else if (pattern.includes('*')) {
      const starIdx = pattern.indexOf('*')
      const prefix = pattern.slice(0, starIdx)
      const suffix = pattern.slice(starIdx + 1)
      if (
        subpath.startsWith(prefix) &&
        (suffix === '' || subpath.endsWith(suffix)) &&
        subpath.length >= prefix.length + suffix.length
      ) {
        const wildcard = subpath.slice(prefix.length, suffix ? subpath.length - suffix.length : undefined)
        const tmpl = typeof value === 'string' ? value : (value?.development ?? value?.default ?? null)
        if (tmpl) template = tmpl.replace('*', wildcard)
      }
    }
    if (template) return path.resolve(pkgDir, template)
  }
  return null
}

export default {
  rules: {
    'no-self-package-imports': {
      meta: {
        type: 'suggestion',
        fixable: 'code',
        schema: [],
        messages: {
          selfImport: "Self-import from own package '{{name}}'. Use a relative import instead.",
        },
      },
      create(context) {
        const filename = context.filename
        if (!filename || filename === '<input>') return {}
        const pkg = findPackageInfo(path.dirname(filename))
        if (!pkg) return {}
        const {name: pkgName, dir: pkgDir, exports: pkgExports} = pkg

        const checkSource = (sourceNode) => {
          const src = sourceNode.value
          const subpath =
            src === pkgName ? '.' : src.startsWith(pkgName + '/') ? '.' + src.slice(pkgName.length) : null
          if (!subpath) return

          const resolvedAbsolute = resolveExportSubpath(pkgExports, pkgDir, subpath)
          if (!resolvedAbsolute) return

          // Skip imports that resolve outside src/ (e.g. ./package.json exports) — relative
          // paths to those files would be outside rootDir and TypeScript would reject them.
          const srcDir = path.join(pkgDir, 'src')
          const relToSrc = path.relative(srcDir, resolvedAbsolute)
          if (relToSrc.startsWith('..')) return

          let rel = path.relative(path.dirname(filename), resolvedAbsolute).replace(/\\/g, '/')
          rel = rel.replace(/\.ts$/, '')
          if (!rel.startsWith('.')) rel = './' + rel

          context.report({
            node: sourceNode,
            messageId: 'selfImport',
            data: {name: pkgName},
            fix: (fixer) => fixer.replaceText(sourceNode, `'${rel}'`),
          })
        }

        return {
          ImportDeclaration: (node) => checkSource(node.source),
          ExportNamedDeclaration: (node) => {
            if (node.source) checkSource(node.source)
          },
          ExportAllDeclaration: (node) => checkSource(node.source),
        }
      },
    },
  },
}

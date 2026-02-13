#!/usr/bin/env node

const packagerSourcemap = process.argv.slice(2, 3)
const compilerSourcemap = process.argv.slice(3, 4)
const outputPath = process.argv.slice(5, 6)

if (!packagerSourcemap) {
  throw new Error('No packagerSourcemap provided')
}
if (!compilerSourcemap) {
  throw new Error('No compilerSourcemap provided')
}
if (!outputPath) {
  throw new Error('No outputPath provided')
}

process.stdout.write(`Successfully ran the compose script for ${packagerSourcemap} ${compilerSourcemap} ${outputPath}`)

return 0

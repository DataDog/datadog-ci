import {promises} from 'fs'
import os from 'os'

import upath from 'upath'

import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {InjectDebugIdCommand} from '../injectDebugId'

const tmpDir = upath.join(os.tmpdir(), 'inject-debug-id-tests')
const runCLI = makeRunCLI(InjectDebugIdCommand, ['react-native', 'inject-debug-id'])

describe('inject-debug-id', () => {
  beforeEach(async () => {
    await promises.mkdir(tmpDir, {recursive: true})
  })

  afterEach(async () => {
    await promises.rm(tmpDir, {recursive: true, force: true})
  })

  test('debug ID is generated and injected when bundle and sourcemap are valid', async () => {
    // GIVEN
    const fixturePath = './src/commands/react-native/__tests__/fixtures/sourcemap-with-no-files'

    const tmpBundlePath = upath.join(tmpDir, 'test-1.js.bundle')
    const tmpSourcemapPath = upath.join(tmpDir, 'test-1.js.bundle.map')

    await promises.copyFile(upath.join(fixturePath, 'empty.min.js'), tmpBundlePath)
    await promises.copyFile(upath.join(fixturePath, 'empty.min.js.map'), tmpSourcemapPath)

    // WHEN
    const {context, code} = await runCLI([tmpDir])

    // THEN
    expect(code).toBe(0)

    const logs = context.stdout.toString().split('\n')

    expect(logs[0]).toBe(`Scanning directory: ${tmpDir}`)
    expect(logs[1]).toMatch(
      /Generated Debug ID for test\-1\.js\.bundle: ([0-9a-fA-F]{8}\b-(?:[0-9a-fA-F]{4}\b-){3}[0-9a-fA-F]{12})/
    )
    expect(logs[2]).toBe(`✅ Debug ID injected into ${tmpBundlePath}`)

    const tmpSourcemap = await promises.readFile(tmpSourcemapPath, {encoding: 'utf8'})
    const tmpSourcemapJson = JSON.parse(tmpSourcemap) as {debugId: string}
    expect(tmpSourcemapJson['debugId']).toBeDefined()
    expect(tmpSourcemapJson['debugId']).toMatch(/[0-9a-fA-F]{8}\b-(?:[0-9a-fA-F]{4}\b-){3}[0-9a-fA-F]{12}/)

    const tmpBundle = await promises.readFile(tmpBundlePath, {encoding: 'utf8'})
    const tmpBundleLines = tmpBundle.split('\n')
    tmpBundleLines.reverse()
    expect(tmpBundleLines[0]).toMatch(/\/\/# debugId=[0-9a-fA-F]{8}\b-(?:[0-9a-fA-F]{4}\b-){3}[0-9a-fA-F]{12}/)
  })

  test('debug ID is extracted from bundle when available', async () => {
    // GIVEN
    const fixturePath = './src/commands/react-native/__tests__/fixtures/sourcemap-with-debug-id-in-bundle'

    const tmpBundlePath = upath.join(tmpDir, 'test-2.js.bundle')
    const tmpSourcemapPath = upath.join(tmpDir, 'test-2.js.bundle.map')

    await promises.copyFile(upath.join(fixturePath, 'main.js.bundle'), tmpBundlePath)
    await promises.copyFile(upath.join(fixturePath, 'main.js.bundle.map'), tmpSourcemapPath)

    // WHEN
    const {context, code} = await runCLI([tmpDir])

    // THEN
    expect(code).toBe(0)

    const logs = context.stdout.toString().split('\n')

    expect(logs[0]).toBe(`Scanning directory: ${tmpDir}`)
    expect(logs[1]).toMatch(
      /Found existing Debug ID for test\-2\.js\.bundle: ([0-9a-fA-F]{8}\b-(?:[0-9a-fA-F]{4}\b-){3}[0-9a-fA-F]{12})/
    )
    expect(logs[2]).toBe(`✅ Debug ID injected into ${tmpBundlePath}`)

    const tmpSourcemap = await promises.readFile(tmpSourcemapPath, {encoding: 'utf8'})
    const tmpSourcemapJson = JSON.parse(tmpSourcemap) as {debugId: string}
    expect(tmpSourcemapJson['debugId']).toBeDefined()
    expect(tmpSourcemapJson['debugId']).toMatch(/[0-9a-fA-F]{8}\b-(?:[0-9a-fA-F]{4}\b-){3}[0-9a-fA-F]{12}/)

    const tmpBundle = await promises.readFile(tmpBundlePath, {encoding: 'utf8'})
    const tmpBundleLines = tmpBundle.split('\n')
    tmpBundleLines.reverse()
    expect(tmpBundleLines[0]).toMatch(/\/\/# debugId=[0-9a-fA-F]{8}\b-(?:[0-9a-fA-F]{4}\b-){3}[0-9a-fA-F]{12}/)
  })

  test('debug ID is extracted from sourcemap when available', async () => {
    // GIVEN
    const fixturePath = './src/commands/react-native/__tests__/fixtures/sourcemap-with-debug-id-in-map'

    const tmpBundlePath = upath.join(tmpDir, 'test-3.js.bundle')
    const tmpSourcemapPath = upath.join(tmpDir, 'test-3.js.bundle.map')

    await promises.copyFile(upath.join(fixturePath, 'main.js.bundle'), tmpBundlePath)
    await promises.copyFile(upath.join(fixturePath, 'main.js.bundle.map'), tmpSourcemapPath)

    // WHEN
    const {context, code} = await runCLI([tmpDir])

    // THEN
    expect(code).toBe(0)

    const logs = context.stdout.toString().split('\n')
    expect(logs[0]).toBe(`Scanning directory: ${tmpDir}`)
    expect(logs[1]).toMatch(
      /Found existing Debug ID for test\-3\.js\.bundle: ([0-9a-fA-F]{8}\b-(?:[0-9a-fA-F]{4}\b-){3}[0-9a-fA-F]{12})/
    )
    expect(logs[2]).toBe(`✅ Debug ID injected into ${tmpBundlePath}`)

    const tmpSourcemap = await promises.readFile(tmpSourcemapPath, {encoding: 'utf8'})
    const tmpSourcemapJson = JSON.parse(tmpSourcemap) as {debugId: string}
    expect(tmpSourcemapJson['debugId']).toBeDefined()
    expect(tmpSourcemapJson['debugId']).toMatch(/[0-9a-fA-F]{8}\b-(?:[0-9a-fA-F]{4}\b-){3}[0-9a-fA-F]{12}/)

    const tmpBundle = await promises.readFile(tmpBundlePath, {encoding: 'utf8'})
    const tmpBundleLines = tmpBundle.split('\n')
    tmpBundleLines.reverse()
    expect(tmpBundleLines[0]).toMatch(/\/\/# debugId=[0-9a-fA-F]{8}\b-(?:[0-9a-fA-F]{4}\b-){3}[0-9a-fA-F]{12}/)
  })

  test('throws error if the files do not match the correct naming convention', async () => {
    // GIVEN
    const fixturePath = './src/commands/react-native/__tests__/fixtures/sourcemap-with-no-files'

    const tmpBundlePath = upath.join(tmpDir, 'wrong.naming.convention.js')
    const tmpSourcemapPath = upath.join(tmpDir, 'wrong.naming.convention.js.map')

    await promises.copyFile(upath.join(fixturePath, 'empty.min.js'), tmpBundlePath)
    await promises.copyFile(upath.join(fixturePath, 'empty.min.js.map'), tmpSourcemapPath)

    // WHEN
    const {context, code} = await runCLI([tmpDir])

    // THEN
    expect(code).toBe(1)

    const errorLogs = context.stderr.toString().split('\n')

    expect(errorLogs[0]).toBe(
      `[ERROR] JS bundle not found in "${tmpDir}". Ensure your files follow the "*.bundle" and "*.bundle.map" naming convention.`
    )
  })
})

import {spawn} from 'node:child_process'
import {readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

import {createRecorder} from '..'
import {postAction, setupAction} from '../action'
import {uploadDirectory} from '../collector'
import * as request from '../request'

import {fixture} from './helpers'

const commandValues = (file: string): Record<string, string> => {
  const values: Record<string, string> = {}
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const separator = lines[i].indexOf('<<')
    if (separator < 0) {
      continue
    }
    const name = lines[i].slice(0, separator)
    const delimiter = lines[i].slice(separator + 2)
    const value: string[] = []
    while (++i < lines.length && lines[i] !== delimiter) {
      value.push(lines[i])
    }
    values[name] = value.join('\n')
  }

  return values
}

describe('directory collection', () => {
  let data: ReturnType<typeof fixture>
  let originalEnv: NodeJS.ProcessEnv
  beforeEach(() => {
    data = fixture()
    originalEnv = process.env
    process.env = {...originalEnv}
    delete process.env.DATADOG_API_KEY
    delete process.env.DD_API_KEY
  })
  afterEach(() => {
    data.cleanup()
    process.env = originalEnv
    jest.restoreAllMocks()
  })

  test('fans out explicitly to all declared main steps, while coalescing native patches', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_CI_BUFFER_DIR: data.buffer}})
    recorder.setTags({version: 'old'}, {levels: ['pipeline', 'job', 'step'], steps: 'all'})
    recorder.setTags({version: 'new'}, {levels: ['pipeline', 'job', 'step'], steps: 'all'})
    expect(await uploadDirectory(data.buffer, {apiKey: 'test'})).toEqual({sent: 5, failed: 0, skipped: 0})
    const bodies = send.mock.calls.map(([config]) => config.data)
    expect(
      bodies
        .filter((body) => (body as any).data.attributes.ci_level === 3)
        .map((body) => (body as any).data.attributes.ci_env.DD_GITHUB_STEP_INDEX)
    ).toEqual(['0', '1', '2'])
    expect(bodies.every((body) => (body as any).data.attributes.tags.version === 'new')).toBe(true)
    expect(readdirSync(data.buffer)).toHaveLength(0)
    expect(await uploadDirectory(data.buffer, {apiKey: 'test'})).toEqual({sent: 0, failed: 0, skipped: 0})
  })

  test('preserves failed records and skips malformed, incomplete, and incompatible files', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(403)
    const recorder = createRecorder({env: {...data.env, DD_CI_BUFFER_DIR: data.buffer}})
    await recorder.span('Build', () => {})
    writeFileSync(join(data.buffer, 'broken.json'), '{')
    writeFileSync(join(data.buffer, 'future.json'), '{"version":2}')
    writeFileSync(join(data.buffer, 'pending.json.tmp'), '{')
    const warning = jest.fn()
    expect(await uploadDirectory(data.buffer, {apiKey: 'test', onWarning: warning})).toEqual({
      sent: 0,
      failed: 1,
      skipped: 2,
    })
    expect(readdirSync(data.buffer)).toHaveLength(4)
    send.mockResolvedValue(202)
    expect(await uploadDirectory(data.buffer, {apiKey: 'test', onWarning: warning})).toEqual({
      sent: 1,
      failed: 0,
      skipped: 2,
    })
    expect(readdirSync(data.buffer)).toHaveLength(3)
  })

  test('collects multiple producers and post phases without explicit flush', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const modulePath = resolve(__dirname, '../../dist/index.js')
    const program = `const {span}=require(process.env.RECORDER_MODULE); span(process.env.PHASE, async current => current.setTags({phase:process.env.PHASE})).catch(()=>process.exitCode=1);`
    await Promise.all(
      ['main', 'subprocess', 'post'].map(
        (phase) =>
          new Promise<void>((done, reject) => {
            const child = spawn(process.execPath, ['-e', program], {
              env: {
                ...data.env,
                DD_CI_BUFFER_DIR: data.buffer,
                DD_CI_PHASE: phase === 'post' ? 'post' : 'main',
                PHASE: phase,
                RECORDER_MODULE: modulePath,
              },
            })
            let errors = ''
            child.stderr.on('data', (chunk) => {
              errors += String(chunk)
            })
            child.once('error', reject)
            child.once('exit', (code) => (code === 0 ? done() : reject(new Error(errors))))
          })
      )
    )
    expect(send).not.toHaveBeenCalled()
    expect(readdirSync(data.buffer)).toHaveLength(3)
    expect(await uploadDirectory(data.buffer, {apiKey: 'test'})).toMatchObject({sent: 3})
  })

  test('setup requires no key and post reads credentials exported later', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    jest.spyOn(console, 'log').mockImplementation(() => {})
    const envFile = join(data.root, 'env')
    const stateFile = join(data.root, 'state')
    writeFileSync(envFile, '')
    writeFileSync(stateFile, '')
    Object.assign(process.env, data.env, {GITHUB_ENV: envFile, GITHUB_STATE: stateFile})
    setupAction()
    const exported = commandValues(envFile)
    expect(exported.DD_CI_BUFFER_DIR).toBeDefined()
    const recorder = createRecorder({env: {...data.env, ...exported}})
    await recorder.span('Build', () => {})
    const state = commandValues(stateFile)
    process.env['STATE_ci-visibility-directory'] = state['ci-visibility-directory']
    process.env.DD_API_KEY = 'late-test-key'
    await postAction()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].apiKey).toBe('late-test-key')
    expect(readFileSync(envFile, 'utf8') + readFileSync(stateFile, 'utf8')).not.toContain('late-test-key')
  })

  test('dry run retains files and requires no API key', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_CI_BUFFER_DIR: data.buffer}})
    await recorder.span('Build', () => {})
    expect(await uploadDirectory(data.buffer, {dryRun: true})).toEqual({sent: 0, failed: 0, skipped: 1})
    expect(send).not.toHaveBeenCalled()
    expect(readdirSync(data.buffer)).toHaveLength(1)
  })
})

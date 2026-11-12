import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

import type {RecordedEvent} from '../types'

import {createRecorder} from '..'
import {planRequests} from '../payloads'
import * as request from '../request'

import {fixture} from './helpers'

describe('CI Visibility recorder', () => {
  let data: ReturnType<typeof fixture>
  beforeEach(() => {
    data = fixture()
  })
  afterEach(() => {
    data.cleanup()
    jest.restoreAllMocks()
  })

  test('records in-process and uploads only at flush, including a late API key', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: data.env})
    expect(
      await recorder.span('Compile', (current) => {
        current.setTags({'build.mode': 'release'})
        current.setMeasure('output.bytes', 42)

        return 'result'
      })
    ).toBe('result')
    recorder.setTags({version: 'old'}, {levels: ['pipeline', 'job', 'step']})
    recorder.setTags({version: 'new'}, {levels: ['pipeline', 'job', 'step']})
    recorder.setMeasure('test.count', 7)
    expect(send).not.toHaveBeenCalled()
    data.env.DD_API_KEY = 'test-key'
    expect(await recorder.flush()).toEqual({sent: 5, failed: 0, skipped: 0})
    expect(send.mock.calls.every(([config]) => config.apiKey === 'test-key')).toBe(true)
    const bodies = send.mock.calls.map(([config]) => config.data)
    expect(bodies).toContainEqual({
      data: {
        type: 'ci_custom_tag',
        attributes: expect.objectContaining({
          ci_level: 0,
          ci_env: expect.objectContaining({GITHUB_JOB: 'build', GITHUB_RUN_ATTEMPT: '2'}),
        }),
      },
    })
    expect(bodies).toContainEqual({
      data: {
        type: 'ci_app_custom_span',
        attributes: expect.objectContaining({
          ci_provider: 'github',
          name: 'Compile',
          tags: expect.objectContaining({'build.mode': 'release'}),
          measures: {'output.bytes': 42},
        }),
      },
    })
    expect(JSON.stringify(bodies)).not.toContain('test-key')
    expect(await recorder.flush()).toEqual({sent: 0, failed: 0, skipped: 0})
    expect(send).toHaveBeenCalledTimes(5)
  })

  test('persists without HTTP or flush and captures identity before upload', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    data.env.DD_CI_BUFFER_DIR = data.buffer
    data.env.DD_API_KEY = 'must-not-be-recorded'
    const recorder = createRecorder({env: data.env})
    recorder.setTags({version: '1'})
    await recorder.span('Build', async () => {})
    data.env.GITHUB_ACTION = 'collector'
    expect(await recorder.flush()).toEqual({sent: 0, failed: 0, skipped: 0})
    const records = readdirSync(data.buffer).map(
      (name) => JSON.parse(readFileSync(join(data.buffer, name), 'utf8')) as RecordedEvent
    )
    expect(records).toHaveLength(2)
    expect(records[0].context.ciEnv).toMatchObject({
      DD_GITHUB_STEP_INDEX: '1',
      DD_GITHUB_JOB_NAME: 'Build',
      GITHUB_RUN_ATTEMPT: '2',
    })
    expect(JSON.stringify(records)).not.toContain('must-not-be-recorded')
    expect(send).not.toHaveBeenCalled()
  })

  test('keeps overlapping spans and native annotations isolated', async () => {
    data.env.DD_CI_BUFFER_DIR = data.buffer
    const recorder = createRecorder({env: data.env})
    recorder.setTags({shared: 'job'})
    await Promise.all(
      ['one', 'two'].map((name) =>
        recorder.span(name, async (current) => {
          await Promise.resolve()
          current.setTags({local: name})
        })
      )
    )
    const records = readdirSync(data.buffer).map(
      (name) => JSON.parse(readFileSync(join(data.buffer, name), 'utf8')) as RecordedEvent
    )
    const spans = planRequests(records).requests.filter((item) => item.url.endsWith('custom_spans'))
    expect(spans.map((item) => item.data)).toEqual(
      expect.arrayContaining(
        ['one', 'two'].map((name) => ({
          data: {
            type: 'ci_app_custom_span',
            attributes: expect.objectContaining({name, tags: expect.objectContaining({local: name})}),
          },
        }))
      )
    )
    expect(JSON.stringify(spans)).not.toContain('shared')
  })

  test('preserves the original error when recording and diagnostic callbacks fail', async () => {
    data.env.DD_CI_BUFFER_DIR = join(data.root, 'missing')
    const recorder = createRecorder({
      env: data.env,
      onWarning: () => {
        throw new Error('warning failed')
      },
    })
    const failure = new Error('build failed')
    await expect(
      recorder.span('Build', () => {
        throw failure
      })
    ).rejects.toBe(failure)
    expect(await recorder.span('Recover', () => 42)).toBe(42)
  })

  test('records failed spans and does not duplicate requests during concurrent flushes', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test'}})
    const failure = new Error('compile failed')
    await expect(
      recorder.span('Compile', () => {
        throw failure
      })
    ).rejects.toBe(failure)
    await Promise.all([recorder.flush(), recorder.flush()])
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].data).toMatchObject({
      data: {attributes: {exit_code: 1, error_message: failure.message}},
    })
  })

  test('skips unknown step identity without dropping the other targets', async () => {
    data.env.GITHUB_ACTION = 'unknown'
    const warning = jest.fn()
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test'}, onWarning: warning})
    recorder.setTags({version: '1'}, {levels: ['pipeline', 'job', 'step']})
    expect(await recorder.flush()).toEqual({sent: 2, failed: 0, skipped: 1})
    expect(send).toHaveBeenCalledTimes(2)
  })

  test('validates annotations without failing the application', async () => {
    const warning = jest.fn()
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: data.env, onWarning: warning})
    recorder.setMeasure('invalid', NaN)
    recorder.setTags({invalid: 12} as unknown as Record<string, string>)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(await recorder.flush()).toEqual({sent: 0, failed: 0, skipped: 0})
    expect(send).not.toHaveBeenCalled()
  })

  test('honors disabling before flush and does not truncate span correlation data', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: data.env})
    await recorder.span('Build', (current) => current.setTags({long: 'x'.repeat(1000)}))
    data.env.DD_CI_VISIBILITY = 'false'
    expect(await recorder.flush()).toEqual({sent: 0, failed: 0, skipped: 1})
    expect(send).not.toHaveBeenCalled()
    data.env.DD_CI_VISIBILITY = 'true'
    await recorder.span('Build', (current) => current.setTags({long: 'x'.repeat(1000)}))
    await recorder.flush({apiKey: 'test'})
    expect(send.mock.calls[0][0].data).toMatchObject({data: {attributes: {tags: {long: 'x'.repeat(1000)}}}})
  })

  test.each([{}, {GITHUB_ACTIONS: 'true', DD_CI_VISIBILITY: 'false'}])(
    'executes application code with reporting disabled: %p',
    async (env) => {
      const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
      const recorder = createRecorder({env})
      expect(
        await recorder.span('Build', (current) => {
          current.setTags({mode: 'test'})

          return 42
        })
      ).toBe(42)
      recorder.setTags({version: '1'})
      await recorder.flush()
      expect(send).not.toHaveBeenCalled()
    }
  )
})

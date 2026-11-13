import type {RecordSpanOptions} from '../types'

import {createRecorder} from '@datadog/ci-visibility/github'

import * as request from '../request'

import {fixture} from './helpers'

describe('Completed CI Visibility spans', () => {
  let data: ReturnType<typeof fixture>
  const startTimeMs = 1_700_000_000_000
  const endTimeMs = startTimeMs + 125

  beforeEach(() => {
    data = fixture()
  })
  afterEach(() => {
    data.cleanup()
    jest.restoreAllMocks()
  })

  test('preserves supplied timing, command, annotations, and context until an explicit flush', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    jest.spyOn(Date, 'now').mockReturnValue(endTimeMs + 60_000)
    const recorder = createRecorder({env: data.env})
    const tags = {'build.mode': 'release'}
    const measures = {'output.bytes': 42}
    recorder.recordSpan({name: 'Compile', command: 'build --release', startTimeMs, endTimeMs, tags, measures})
    tags['build.mode'] = 'changed'
    measures['output.bytes'] = 100
    data.env.DD_GITHUB_JOB_NAME = 'Later job'
    expect(send).not.toHaveBeenCalled()

    data.env.DD_API_KEY = 'test-key'
    expect(await recorder.flush()).toEqual({sent: 1, failed: 0, skipped: 0})
    expect(send.mock.calls[0][0]).toMatchObject({
      apiKey: 'test-key',
      url: '/api/intake/ci/custom_spans',
      data: {
        data: {
          type: 'ci_app_custom_span',
          attributes: {
            ci_provider: 'github',
            span_id: expect.stringMatching(/^[0-9a-f]{16}$/),
            name: 'Compile',
            command: 'build --release',
            start_time: new Date(startTimeMs).toISOString(),
            end_time: new Date(endTimeMs).toISOString(),
            exit_code: 0,
            error_message: '',
            tags: expect.objectContaining({'build.mode': 'release', 'ci.job.name': 'Build'}),
            measures: {'output.bytes': 42},
          },
        },
      },
    })
    expect(await recorder.flush()).toEqual({sent: 0, failed: 0, skipped: 0})
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('accepts zero duration and defaults the command to the span name', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test-key'}})
    recorder.recordSpan({name: 'Restore cache', startTimeMs, endTimeMs: startTimeMs})
    expect(await recorder.flush()).toEqual({sent: 1, failed: 0, skipped: 0})
    expect(send.mock.calls[0][0].data).toMatchObject({
      data: {
        attributes: {
          name: 'Restore cache',
          command: 'Restore cache',
          start_time: new Date(startTimeMs).toISOString(),
          end_time: new Date(startTimeMs).toISOString(),
        },
      },
    })
  })

  test.each([
    {options: {exitCode: 7}, exitCode: 7, errorMessage: 'Span failed'},
    {options: {error: new Error('Compile failed')}, exitCode: 1, errorMessage: 'Compile failed'},
    {options: {error: 'Compile failed'}, exitCode: 1, errorMessage: 'Compile failed'},
    {options: {exitCode: 0, error: new Error('ignored')}, exitCode: 0, errorMessage: ''},
  ])('records an explicit outcome: $errorMessage ($exitCode)', async ({options, exitCode, errorMessage}) => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test-key'}})
    recorder.recordSpan({name: 'Compile', startTimeMs, endTimeMs, ...options})
    expect(await recorder.flush()).toEqual({sent: 1, failed: 0, skipped: 0})
    expect(send.mock.calls[0][0].data).toMatchObject({
      data: {attributes: {exit_code: exitCode, error_message: errorMessage}},
    })
  })

  test.each([
    {startTimeMs: undefined},
    {endTimeMs: undefined},
    {startTimeMs: '1700000000000'},
    {startTimeMs: NaN},
    {endTimeMs: Infinity},
    {startTimeMs: startTimeMs + 0.5},
    {endTimeMs: startTimeMs - 1},
    {startTimeMs: Number.MAX_SAFE_INTEGER, endTimeMs: Number.MAX_SAFE_INTEGER},
    {name: ''},
    {name: 42},
    {command: ''},
    {command: 42},
  ])('skips invalid completed spans without throwing: %p', async (invalid) => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const onWarning = jest.fn()
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test-key'}, onWarning})
    const options = {name: 'Compile', startTimeMs, endTimeMs, ...invalid} as unknown as RecordSpanOptions
    expect(() => recorder.recordSpan(options)).not.toThrow()
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(await recorder.flush()).toEqual({sent: 0, failed: 0, skipped: 0})
    expect(send).not.toHaveBeenCalled()
  })

  test.each([{}, {GITHUB_ACTIONS: 'true', DD_CI_VISIBILITY_ENABLED: 'false'}])(
    'does not record or warn when reporting is disabled: %p',
    async (env) => {
      const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
      const onWarning = jest.fn()
      const recorder = createRecorder({
        env: {...data.env, GITHUB_ACTIONS: undefined, DD_API_KEY: 'test-key', ...env},
        onWarning,
      })
      recorder.recordSpan({name: 'Compile', startTimeMs: NaN, endTimeMs})
      expect(await recorder.flush()).toEqual({sent: 0, failed: 0, skipped: 0})
      expect(send).not.toHaveBeenCalled()
      expect(onWarning).not.toHaveBeenCalled()
    }
  )
})

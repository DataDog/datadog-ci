import {createRecorder} from '@datadog/ci-visibility/github'

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

  test('captures the originating identity before an explicit flush', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const env = {...data.env, DD_API_KEY: 'test-key'}
    const recorder = createRecorder({env})
    recorder.setTags({version: '1'}, {levels: ['job', 'step']})
    await recorder.span('Build', async () => {})
    Object.assign(env, {GITHUB_ACTION: 'later', DD_GITHUB_STEP_INDEX: '9', DD_GITHUB_JOB_NAME: 'Later job'})
    expect(send).not.toHaveBeenCalled()
    expect(await recorder.flush()).toEqual({sent: 3, failed: 0, skipped: 0})
    const step = send.mock.calls.find(
      ([config]) => config.url.endsWith('tags') && (config.data as any).data.attributes.ci_level === 3
    )
    expect(step?.[0].data).toMatchObject({
      data: {
        attributes: {
          ci_env: {
            DD_GITHUB_STEP_INDEX: '1',
            DD_GITHUB_JOB_NAME: 'Build',
            GITHUB_RUN_ATTEMPT: '2',
          },
        },
      },
    })
    expect(JSON.stringify(send.mock.calls.map(([config]) => config.data))).not.toContain('test-key')
  })

  test('ends a manual span once, preserving explicit status, timing, and annotations', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000)
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test'}})
    const current = recorder.startSpan('Build', {'tool.version': '1', mode: 'initial'})
    expect(await recorder.flush()).toEqual({sent: 0, failed: 0, skipped: 0})
    current.setTags({mode: 'running'})
    current.setMeasure('output.bytes', 12)
    now.mockReturnValue(1123)
    expect(current.end({exitCode: 7, tags: {mode: 'final'}, measures: {'output.bytes': 42}})).toBe(123)
    expect(current.end({exitCode: 0})).toBe(123)
    current.setTags({late: 'ignored'})
    current.setMeasure('late', 1)
    expect(send).not.toHaveBeenCalled()
    expect(await recorder.flush()).toEqual({sent: 1, failed: 0, skipped: 0})
    const body = send.mock.calls[0][0].data
    expect(body).toMatchObject({
      data: {
        attributes: {
          name: 'Build',
          start_time: '1970-01-01T00:00:01.000Z',
          end_time: '1970-01-01T00:00:01.123Z',
          exit_code: 7,
          error_message: 'Span failed',
          tags: {'tool.version': '1', mode: 'final'},
          measures: {'output.bytes': 42},
        },
      },
    })
    expect(JSON.stringify(body)).not.toContain('late')
    expect(await recorder.flush()).toEqual({sent: 0, failed: 0, skipped: 0})
  })

  test.each([
    {options: {error: new Error('build failed')}, exitCode: 1, message: 'build failed'},
    {options: {exitCode: 23, error: 'command failed'}, exitCode: 23, message: 'command failed'},
    {options: {exitCode: 0, error: new Error('ignored')}, exitCode: 0, message: ''},
  ])('records a manual outcome without throwing: $exitCode', async ({options, exitCode, message}) => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test'}})
    expect(() => recorder.startSpan('Build').end(options)).not.toThrow()
    await recorder.flush()
    expect(send.mock.calls[0][0].data).toMatchObject({
      data: {attributes: {exit_code: exitCode, error_message: message}},
    })
  })

  test('preserves an explicitly ended callback span and its nonthrowing result', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test'}})
    expect(
      await recorder.span('Build', (current) => {
        current.end({exitCode: 7})

        return 7
      })
    ).toBe(7)
    expect(await recorder.flush()).toEqual({sent: 1, failed: 0, skipped: 0})
    expect(send.mock.calls[0][0].data).toMatchObject({data: {attributes: {exit_code: 7}}})
  })

  test('keeps the manual outcome when end annotations are invalid', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const warning = jest.fn()
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test'}, onWarning: warning})
    const current = recorder.startSpan('Build', {mode: 'release'})
    expect(() =>
      current.end({
        exitCode: 3,
        error: new Error('build failed'),
        tags: {invalid: 12} as unknown as Record<string, string>,
        measures: {invalid: NaN},
      })
    ).not.toThrow()
    expect(await recorder.flush()).toEqual({sent: 1, failed: 0, skipped: 0})
    expect(send.mock.calls[0][0].data).toMatchObject({
      data: {attributes: {exit_code: 3, error_message: 'build failed', tags: {mode: 'release'}, measures: {}}},
    })
    expect(warning).toHaveBeenCalledTimes(1)
  })

  test('keeps overlapping spans and native annotations isolated', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test'}})
    recorder.setTags({shared: 'job'})
    await Promise.all(
      ['one', 'two'].map((name) =>
        recorder.span(name, async (current) => {
          await Promise.resolve()
          current.setTags({local: name})
        })
      )
    )
    expect(send).not.toHaveBeenCalled()
    expect(await recorder.flush()).toEqual({sent: 3, failed: 0, skipped: 0})
    const spans = send.mock.calls
      .filter(([config]) => config.url.endsWith('custom_spans'))
      .map(([config]) => config.data)
    expect(spans).toEqual(
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

  test('preserves the original error when recording, upload, and diagnostic callbacks fail', async () => {
    jest.spyOn(request, 'httpRequest').mockRejectedValue(new request.TransportError('unreachable'))
    const recorder = createRecorder({
      env: {...data.env, DD_API_KEY: 'test'},
      onWarning: () => {
        throw new Error('warning failed')
      },
    })
    const failure = new Error('build failed')
    await expect(
      (async () => {
        try {
          await recorder.span('Build', (current) => {
            current.setMeasure('invalid', NaN)
            throw failure
          })
        } finally {
          await recorder.flush()
        }
      })()
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

  test('fans out to all declared main steps and merges native patches before flush', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(202)
    const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test'}})
    recorder.setTags({version: 'old'}, {levels: ['pipeline', 'job', 'step'], steps: 'all'})
    recorder.setTags({version: 'new'}, {levels: ['pipeline', 'job', 'step'], steps: 'all'})
    expect(send).not.toHaveBeenCalled()
    expect(await recorder.flush()).toEqual({sent: 5, failed: 0, skipped: 0})
    const bodies = send.mock.calls.map(([config]) => config.data as any)
    expect(
      bodies
        .filter((body) => body.data.attributes.ci_level === 3)
        .map((body) => body.data.attributes.ci_env.DD_GITHUB_STEP_INDEX)
    ).toEqual(['0', '1', '2'])
    expect(bodies.every((body) => body.data.attributes.tags.version === 'new')).toBe(true)
  })

  test('keeps recorder queues independent and drains failed uploads', async () => {
    const send = jest.spyOn(request, 'httpRequest').mockResolvedValue(403)
    const options = {env: {...data.env, DD_API_KEY: 'test'}, onWarning: jest.fn()}
    const first = createRecorder(options)
    const second = createRecorder(options)
    await first.span('First', () => {})
    await second.span('Second', () => {})
    expect(await first.flush()).toEqual({sent: 0, failed: 1, skipped: 0})
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].data).toMatchObject({data: {attributes: {name: 'First'}}})
    expect(await first.flush()).toEqual({sent: 0, failed: 0, skipped: 0})
    send.mockResolvedValue(202)
    expect(await second.flush()).toEqual({sent: 1, failed: 0, skipped: 0})
    expect(send.mock.calls[1][0].data).toMatchObject({data: {attributes: {name: 'Second'}}})
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
      const manual = recorder.startSpan('Manual', {mode: 'test'})
      manual.setTags({mode: 'updated'})
      manual.setMeasure('count', 1)
      expect(manual.end({error: new Error('ignored')})).toBeGreaterThanOrEqual(0)
      await recorder.flush()
      expect(send).not.toHaveBeenCalled()
    }
  )
})

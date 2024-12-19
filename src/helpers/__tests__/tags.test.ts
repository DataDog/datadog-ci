import {BaseContext} from 'clipanion'
import simpleGit from 'simple-git'

import {SpanTags} from '../interfaces'
import {
  parseTags,
  parseMetrics,
  getSpanTags,
  parseTagsFile,
  parseMeasuresFile,
  getMissingRequiredGitTags,
  GIT_REPOSITORY_URL,
  GIT_BRANCH,
  GIT_SHA,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_COMMIT_COMMITTER_EMAIL,
  GIT_COMMIT_COMMITTER_NAME,
} from '../tags'

jest.mock('simple-git')

const fixturesPath = './src/helpers/__tests__/tags-fixtures'
const createMockContext = (): BaseContext => {
  let out = ''
  let err = ''

  return {
    stderr: {
      toString: () => err,
      write: (input: string) => {
        err += input

        return true
      },
    },
    stdout: {
      toString: () => out,
      write: (input: string) => {
        out += input

        return true
      },
    },
  } as BaseContext
}

describe('parseTags', () => {
  test('falls back to empty object if invalid format', () => {
    expect(parseTags([''])).toEqual({})
    expect(parseTags(['not.correct.format'])).toEqual({})
    expect(parseTags(['not.correct.format,either'])).toEqual({})
  })
  test('returns an object with the tags with well formatted strings', () => {
    expect(parseTags(['key1:value1', 'key2:value2'])).toEqual({key1: 'value1', key2: 'value2'})
  })
  test('should not include invalid key:value pairs', () => {
    expect(parseTags(['key1:value1', 'key2:value2', 'invalidkeyvalue'])).toEqual({key1: 'value1', key2: 'value2'})
  })
})

describe('parseTagsFile', () => {
  test('valid', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, `${fixturesPath}/tags-valid.json`)
    expect(valid).toBe(true)
    expect(tags).toEqual({foo: 'hello', bar: 'world'})
  })
  test('valid but ignores data', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, `${fixturesPath}/tags-mixed.json`)
    expect(valid).toBe(true)
    expect(tags).toEqual({
      tag1: 'value1',
      metric_mistake: '123',
      my_boolean: 'true',
      tag4: 'value4',
    })
    expect(context.stdout.toString()).toContain("[WARN] tag 'metric_mistake' was not a string, converting to string")
  })
  test('nested fields should be removed', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, `${fixturesPath}/tags-with-nested-fields.json`)
    expect(valid).toBe(true)
    expect(tags).toEqual({bar: 'world'})
    expect(context.stdout.toString()).toContain("[WARN] tag 'foo' had nested fields which will be ignored")
  })
  test('empty file path', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, '')
    expect(valid).toBe(true)
    expect(tags).toEqual({})
  })
  test('undefined file path', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, undefined)
    expect(valid).toBe(true)
    expect(tags).toEqual({})
  })
  test('file does not exist', () => {
    const context = createMockContext()
    const [_, valid] = parseTagsFile(context, 'non-existent-file.json')
    expect(valid).toBe(false)
    expect(context.stderr.toString()).toContain("[ERROR] file 'non-existent-file.json' does not exist")
  })
  test('path points to folder', () => {
    const context = createMockContext()
    const [_, valid] = parseTagsFile(context, `${fixturesPath}/invalid`)
    expect(valid).toBe(false)
    expect(context.stderr.toString()).toContain('did not point to a file')
  })
  test('file is not a JSON', () => {
    const context = createMockContext()
    const [_, valid] = parseTagsFile(context, `${fixturesPath}/invalid/not-a-json.yaml`)
    expect(valid).toBe(false)
    expect(context.stderr.toString()).toContain('is not a JSON file')
  })
})

describe('parseMetrics', () => {
  test('falls back to empty object if invalid format', () => {
    expect(parseMetrics([''])).toEqual({})
    expect(parseMetrics(['not.correct.format'])).toEqual({})
    expect(parseMetrics(['not.correct.format,either'])).toEqual({})
  })
  test('returns an object with the tags with well formatted numbers', () => {
    expect(parseMetrics(['key1:123', 'key2:321', 'key3:321.1', 'key4:-123.1'])).toEqual({
      key1: 123,
      key2: 321,
      key3: 321.1,
      key4: -123.1,
    })
  })
  test('should not include invalid key:value pairs', () => {
    expect(parseMetrics(['key1:123', 'key2:321', 'invalidkeyvalue', 'key3:a'])).toEqual({key1: 123, key2: 321})
  })
})

describe('parseMetricsFile', () => {
  test('valid', () => {
    const context = createMockContext()
    const [measures, valid] = parseMeasuresFile(context, `${fixturesPath}/measures-valid.json`)
    expect(valid).toBe(true)
    expect(measures).toEqual({foo: 123, bar: 456})
  })
  test('valid but ignores data', () => {
    const context = createMockContext()
    const [measures, valid] = parseMeasuresFile(context, `${fixturesPath}/measures-mixed.json`)
    expect(valid).toBe(true)
    expect(measures).toEqual({measure: 888})
    expect(context.stdout.toString()).toContain('ignoring field')
  })
})

describe('getSpanTags', () => {
  test('should parse DD_TAGS and DD_ENV environment variables', async () => {
    process.env.DD_TAGS = 'key1:https://google.com,key2:value2'
    process.env.DD_ENV = 'ci'

    const spanTags: SpanTags = await getSpanTags(
      {
        apiKey: undefined,
        env: process.env.DD_ENV,
        envVarTags: process.env.DD_TAGS,
      },
      undefined,
      true
    )
    expect(spanTags).toMatchObject({
      env: 'ci',
      key1: 'https://google.com',
      key2: 'value2',
    })
  })
  test('should parse tags argument', async () => {
    const spanTags: SpanTags = await getSpanTags(
      {
        apiKey: undefined,
        env: undefined,
        envVarTags: undefined,
      },
      ['key1:value1', 'key2:value2'],
      true
    )
    expect(spanTags).toMatchObject({
      key1: 'value1',
      key2: 'value2',
    })
  })
})

describe('sarif and sbom upload required git tags', () => {
  // throwError will be used to simulate an error being thrown from simple-git
  // commands and is used to condense the tests code.
  const throwError = () => {
    throw new Error()
  }

  // Reset all env vars before each test
  beforeEach(() => {
    // User defined env vars
    process.env.DD_GIT_BRANCH = ''
    process.env.DD_GIT_COMMIT_SHA = ''
    process.env.DD_GIT_COMMIT_AUTHOR_EMAIL = ''
    process.env.DD_GIT_COMMIT_AUTHOR_NAME = ''
    process.env.DD_GIT_COMMIT_COMMITTER_EMAIL = ''
    process.env.DD_GIT_COMMIT_COMMITTER_NAME = ''
    // CI defined env vars - needed for tests to pass in the CI
    process.env.GITHUB_SHA = ''
    process.env.GITHUB_HEAD_REF = ''
    process.env.GITHUB_REF = ''
  })

  test('should be valid as we have all required git fields', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      branch: () => ({current: 'main'}),
      listRemote: async (git: any): Promise<string> => 'https://www.github.com/datadog/safe-repository',
      revparse: () => 'commitSHA',
      show: (input: string[]) => {
        if (input[1] === '--format=%s') {
          return 'commit message'
        }

        return 'authorName,authorEmail,authorDate,committerName,committerEmail,committerDate'
      },
    }))
    const spanTags: SpanTags = await getSpanTags(
      {
        apiKey: undefined,
        env: undefined,
        envVarTags: undefined,
      },
      [],
      true
    )
    const missingTags = getMissingRequiredGitTags(spanTags)
    expect(missingTags).toHaveLength(0)
  })

  test('should be valid when all fields are specified using env vars', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      branch: throwError,
      listRemote: throwError,
      revparse: throwError,
      show: throwError,
    }))

    process.env.DD_GIT_REPOSITORY_URL = 'https://www.github.com/datadog/safe-repository'
    process.env.DD_GIT_BRANCH = 'main'
    process.env.DD_GIT_COMMIT_SHA = 'commitSHA'
    process.env.DD_GIT_COMMIT_AUTHOR_EMAIL = 'authorEmail'
    process.env.DD_GIT_COMMIT_AUTHOR_NAME = 'authorName'
    process.env.DD_GIT_COMMIT_COMMITTER_EMAIL = 'committerEmail'
    process.env.DD_GIT_COMMIT_COMMITTER_NAME = 'committerName'

    const spanTags: SpanTags = await getSpanTags(
      {
        apiKey: undefined,
        env: undefined,
        envVarTags: undefined,
      },
      [],
      true
    )
    const missingTags = getMissingRequiredGitTags(spanTags)
    expect(missingTags).toHaveLength(0)
  })

  test('should not be valid when missing an env var', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      branch: throwError,
      listRemote: throwError,
      revparse: throwError,
      show: throwError,
    }))

    process.env.DD_GIT_REPOSITORY_URL = 'https://www.github.com/datadog/safe-repository'
    process.env.DD_GIT_BRANCH = 'main'
    // missing DD_GIT_COMMIT_SHA
    process.env.DD_GIT_COMMIT_AUTHOR_EMAIL = 'authorEmail'
    process.env.DD_GIT_COMMIT_AUTHOR_NAME = 'authorName'
    process.env.DD_GIT_COMMIT_COMMITTER_EMAIL = 'committerEmail'
    process.env.DD_GIT_COMMIT_COMMITTER_NAME = 'committerName'

    const spanTags: SpanTags = await getSpanTags(
      {
        apiKey: undefined,
        env: undefined,
        envVarTags: undefined,
      },
      [],
      true
    )
    const missingTags = getMissingRequiredGitTags(spanTags)
    expect(missingTags).toHaveLength(1)
    expect(missingTags).toContain(GIT_SHA)
  })

  test('should be invalid when no git metadata is there (no .git)', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      branch: throwError,
      listRemote: throwError,
      revparse: throwError,
      show: throwError,
    }))
    const spanTags: SpanTags = await getSpanTags(
      {
        apiKey: undefined,
        env: undefined,
        envVarTags: undefined,
      },
      [],
      true
    )
    const missingTags = getMissingRequiredGitTags(spanTags)
    expect(missingTags).toHaveLength(6)
    expect(missingTags).toContain(GIT_BRANCH)
    expect(missingTags).toContain(GIT_SHA)
    expect(missingTags).toContain(GIT_COMMIT_AUTHOR_EMAIL)
    expect(missingTags).toContain(GIT_COMMIT_AUTHOR_NAME)
    expect(missingTags).toContain(GIT_COMMIT_COMMITTER_EMAIL)
    expect(missingTags).toContain(GIT_COMMIT_COMMITTER_NAME)
  })

  test('should be invalid when an env var overrides a value retrieved from git', async () => {
    ;(simpleGit as jest.Mock).mockImplementation(() => ({
      branch: () => ({current: 'main'}),
      listRemote: async (git: any): Promise<string> => 'https://www.github.com/datadog/safe-repository',
      revparse: () => 'commitSHA',
      show: (input: string[]) => {
        if (input[1] === '--format=%s') {
          return 'commit message'
        }

        return 'authorName,authorEmail,authorDate,committerName,committerEmail,committerDate'
      },
    }))

    process.env.DD_GIT_BRANCH = '    '

    const spanTags: SpanTags = await getSpanTags(
      {
        apiKey: undefined,
        env: undefined,
        envVarTags: undefined,
      },
      [],
      true
    )
    const missingTags = getMissingRequiredGitTags(spanTags)
    expect(missingTags).toHaveLength(1)
    expect(missingTags).toContain(GIT_BRANCH)
  })
})

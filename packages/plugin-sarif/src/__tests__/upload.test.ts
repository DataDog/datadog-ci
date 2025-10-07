import fs from 'fs'
import os from 'os'

import {createCommand, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import simpleGit from 'simple-git'
import upath from 'upath'

import {PluginCommand as SarifUploadCommand} from '../commands/upload'
import {renderInvalidFile} from '../renderer'

const createMockContext = () => {
  let data = ''

  return {
    stdout: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
    stderr: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
  }
}

// Mock context for CI event validation tests with compatible write signatures
// We care about stdout vs stderr for validating error messages
const createSimpleMockContext = () => {
  let stdoutData = ''
  let stderrData = ''

  return {
    stdout: {
      toString: () => stdoutData,
      write: (input?: string) => {
        if (input) {
          stdoutData += input
        }
      },
    },
    stderr: {
      toString: () => stderrData,
      write: (input?: string) => {
        if (input) {
          stderrData += input
        }
      },
    },
  }
}

// Always posix, even on Windows.
const CWD = upath.normalize(process.cwd())

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = createCommand(SarifUploadCommand, {stdout: {write}})

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DATADOG_API_KEY')
    })
  })
  describe('getMatchingSarifReports', () => {
    test('should read all sarif reports and reject invalid ones', async () => {
      const context = createMockContext()
      const command = createCommand(SarifUploadCommand)
      const [firstFile, secondFile] = await command['getMatchingSarifReports'].call(
        {
          basePaths: ['./src/__tests__/fixtures'],
          config: {},
          context,
        },
        {}
      )

      expect(firstFile).toMatchObject({
        reportPath: './src/__tests__/fixtures/valid-results.sarif',
      })
      expect(secondFile).toMatchObject({
        reportPath: './src/__tests__/fixtures/valid-no-results.sarif',
      })

      const getInvalidJsonUnexpectedTokenErrorMessage = () => {
        try {
          JSON.parse('this is an invalid sarif report')
        } catch (e) {
          // This error message is different in Node.js >=20
          return (e as SyntaxError).message
        }

        throw Error('unreachable')
      }

      const output = context.stdout.toString()
      expect(output).toContain(
        renderInvalidFile('./src/__tests__/fixtures/empty.sarif', ['Unexpected end of JSON input'])
      )
      expect(output).toContain(
        renderInvalidFile('./src/__tests__/fixtures/invalid.sarif', [getInvalidJsonUnexpectedTokenErrorMessage()])
      )
      expect(output).toContain(
        renderInvalidFile('./src/__tests__/fixtures/invalid-result.sarif', [
          "/runs/0/results/0: must have required property 'message'",
        ])
      )
    })

    test('should allow single files', async () => {
      const context = createMockContext()
      const command = createCommand(SarifUploadCommand)
      const files = await command['getMatchingSarifReports'].call(
        {
          basePaths: ['./src/__tests__/fixtures/valid-results.sarif'],
          config: {},
          context,
        },
        {}
      )

      expect(files.length).toEqual(1)

      expect(files[0]).toMatchObject({
        reportPath: './src/__tests__/fixtures/valid-results.sarif',
      })
    })

    test('should not fail for invalid single files', async () => {
      const context = createMockContext()
      const command = createCommand(SarifUploadCommand)
      const files = await command['getMatchingSarifReports'].call(
        {
          basePaths: ['./src/__tests__/fixtures/does-not-exist.sarif'],
          config: {},
          context,
        },
        {}
      )

      expect(files.length).toEqual(0)
    })

    test('should allow folder and single unit paths', async () => {
      const context = createMockContext()
      const command = createCommand(SarifUploadCommand)
      const [firstFile, secondFile, thirdFile] = await command['getMatchingSarifReports'].call(
        {
          basePaths: ['./src/__tests__/fixtures', './src/__tests__/fixtures/subfolder/valid-results.sarif'],
          config: {},
          context,
        },
        {}
      )
      expect(firstFile).toMatchObject({
        reportPath: './src/__tests__/fixtures/valid-results.sarif',
      })
      expect(secondFile).toMatchObject({
        reportPath: './src/__tests__/fixtures/valid-no-results.sarif',
      })
      expect(thirdFile).toMatchObject({
        reportPath: './src/__tests__/fixtures/subfolder/valid-results.sarif',
      })
    })

    test('should not have repeated files', async () => {
      const context = createMockContext()
      const command = createCommand(SarifUploadCommand)
      const files = await command['getMatchingSarifReports'].call(
        {
          basePaths: ['./src/__tests__/fixtures', './src/commands/junit/__tests__/fixtures/valid-results.sarif'],
          config: {},
          context,
        },
        {}
      )

      expect(files.length).toEqual(2)
    })
  })
})

describe('execute', () => {
  const runCLI = makeRunCLI(SarifUploadCommand, ['sarif', 'upload', '--env', 'ci', '--dry-run'])

  describe('CI event validation', () => {
    test('should exit with error for GitHub pull_request event', async () => {
      const originalEnv = {...process.env}
      process.env.GITHUB_EVENT_NAME = 'pull_request'

      try {
        const context = createSimpleMockContext()
        const command = createCommand(SarifUploadCommand, context)
        command['basePaths'] = ['./src/__tests__/fixtures/subfolder']

        const code = await command.execute()
        const output = context.stdout.toString()

        expect(code).toBe(1)
        expect(output).toContain('::error title=Unsupported Trigger::')
        expect(output).toContain('The pull_request trigger is not supported by Datadog Code Security')
        expect(output).toContain('Use the push event instead')
      } finally {
        process.env = originalEnv
      }
    })

    test('should exit with error for GitLab merge_request_event', async () => {
      const originalEnv = {...process.env}
      process.env.CI_PIPELINE_SOURCE = 'merge_request_event'

      try {
        const context = createSimpleMockContext()
        const command = createCommand(SarifUploadCommand, context)
        command['basePaths'] = ['./src/__tests__/fixtures/subfolder']

        const code = await command.execute()
        const output = context.stderr.toString()

        expect(code).toBe(1)
        expect(output).toContain('The merge_request_event trigger is not supported by Datadog Code Security')
        expect(output).toContain('Use the push event instead')
      } finally {
        process.env = originalEnv
      }
    })

    test('should exit with error for Azure PullRequest event', async () => {
      const originalEnv = {...process.env}
      process.env.BUILD_REASON = 'PullRequest'

      try {
        const context = createSimpleMockContext()
        const command = createCommand(SarifUploadCommand, context)
        command['basePaths'] = ['./src/__tests__/fixtures/subfolder']

        const code = await command.execute()
        const output = context.stdout.toString()

        expect(code).toBe(1)
        expect(output).toContain('##vso[task.logissue type=error]')
        expect(output).toContain('The PullRequest trigger is not supported by Datadog Code Security')
        expect(output).toContain('Use the push event instead')
      } finally {
        process.env = originalEnv
      }
    })
  })

  test('relative path with double dots', async () => {
    const {context, code} = await runCLI(['./src/__tests__/doesnotexist/../fixtures/subfolder'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/__tests__/fixtures/subfolder'],
      concurrency: 20,
      env: 'ci',
    })
  })

  test('multiple paths', async () => {
    const {context, code} = await runCLI([
      'src/__tests__/fixtures/subfolder/',
      'src/__tests__/fixtures/another_subfolder/',
    ])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/__tests__/fixtures/subfolder/', 'src/__tests__/fixtures/another_subfolder/'],
      concurrency: 20,
      env: 'ci',
    })
  })

  test('absolute path', async () => {
    const cwd = upath.normalize(process.cwd())
    const {context, code} = await runCLI([cwd + '/src/__tests__/fixtures/subfolder'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: [`${cwd}/src/__tests__/fixtures/subfolder`],
      concurrency: 20,
      env: 'ci',
      spanTags: {
        'git.repository_url': 'DataDog/datadog-ci',
        env: 'ci',
      },
    })
  })

  test('absolute path when passing git repository', async () => {
    const tmpdir = fs.mkdtempSync(upath.join(os.tmpdir(), 'gitPath-'))
    try {
      // Configure local git repository
      const git = simpleGit(tmpdir)
      setupLocalGitConfig(tmpdir)

      await git.init()

      // eslint-disable-next-line no-null/no-null
      await git.commit('Initial commit', [], {'--allow-empty': null})
      const repositoryParam = `--git-repository=${tmpdir}`

      const {context, code} = await runCLI([repositoryParam, CWD + '/src/__tests__/fixtures/subfolder'])

      const output = context.stdout.toString().split('\n')
      expect(code).toBe(0)

      checkConsoleOutput(output, {
        basePaths: [`${CWD}/src/__tests__/fixtures/subfolder`],
        concurrency: 20,
        env: 'ci',
        spanTags: {
          'git.repository_url': 'mock-repo.local/fake.git',
          'git.branch': 'mock-branch',
          'git.commit.message': 'Initial commit',
          'git.commit.committer.email': 'mock@fake.local',
          'git.commit.committer.name': 'MockUser123',
          'git.commit.author.email': 'mock@fake.local',
          'git.commit.author.name': 'MockUser123',
          env: 'ci',
        },
      })
    } finally {
      // Removed temporary git file
      fs.rmSync(tmpdir, {recursive: true, force: true})
    }
  })

  test('absolute path when passing git repository which does not exist', async () => {
    const nonExistingGitRepository = '/you/cannot/find/me'
    const repositoryParam = `--git-repository=${nonExistingGitRepository}`

    // Pass a git repository which does not exist, command should fail
    const {code} = await runCLI([repositoryParam, CWD + '/src/__tests__/fixtures/subfolder'])
    expect(code).toBe(1)
  })

  test('single file', async () => {
    const {context, code} = await runCLI([CWD + '/src/__tests__/fixtures/valid-results.sarif'])
    const output = context.stdout.toString().split('\n')
    const path = `${CWD}/src/__tests__/fixtures/valid-results.sarif`
    expect(code).toBe(0)
    expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD SARIF REPORT')
    expect(output[1]).toContain('Starting upload with concurrency 20.')
    expect(output[2]).toContain(`Will upload SARIF report file ${path}`)
    expect(output[3]).toContain('Only one upload per commit, env and tool')
    expect(output[4]).toContain(`Preparing upload for`)
    expect(output[4]).toContain(`env:ci`)
  })

  test('not found file', async () => {
    const {context, code} = await runCLI([CWD + '/src/__tests__/fixtures/not-found.sarif'])
    const output = context.stdout.toString().split('\n')
    const path = `${CWD}/src/__tests__/fixtures/not-found.sarif`
    expect(code).toBe(1)
    expect(output[0]).toContain(`Cannot find valid SARIF report files to upload in ${path}`)
    expect(output[1]).toContain('Check the files exist and are valid.')
  })
})

interface ExpectedOutput {
  basePaths: string[]
  concurrency: number
  env: string
  spanTags?: Record<string, string>
}

const checkConsoleOutput = (output: string[], expected: ExpectedOutput) => {
  expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD SARIF REPORT')
  expect(output[1]).toContain(`Starting upload with concurrency ${expected.concurrency}.`)
  expect(output[2]).toContain(`Will look for SARIF report files in ${expected.basePaths.join(', ')}`)
  expect(output[3]).toContain('Only one upload per commit, env and tool')
  expect(output[4]).toContain(`Preparing upload for`)
  expect(output[4]).toContain(`env:${expected.env}`)

  if (expected.spanTags) {
    const regex = /with tags (\{.*\})/
    const match = output[5].match(regex)
    expect(match).not.toBeNull()

    const spanTags = JSON.parse(match![1])
    Object.keys(expected.spanTags).forEach((k) => {
      expect(spanTags[k]).not.toBeNull()
      expect(spanTags[k]).toContain(expected.spanTags![k])
    })
  }
}

const getFixtures = (file: string) => {
  return upath.join('./src/__tests__/fixtures', file)
}

const setupLocalGitConfig = (dir: string) => {
  const gitDir = upath.join(dir, '.git')
  if (!fs.existsSync(gitDir)) {
    fs.mkdirSync(gitDir, {recursive: true})
  }

  const configFixture = fs.readFileSync(getFixtures('gitconfig'), 'utf8')
  const configPath = upath.join(gitDir, '/config')
  fs.writeFileSync(configPath, configFixture)
}
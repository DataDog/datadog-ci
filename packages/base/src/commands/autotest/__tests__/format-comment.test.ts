import {getCiJobUrl, formatComment, type AgentReport, type AgentFinding} from '../review'

describe('getCiJobUrl', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {...originalEnv}
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns GitHub Actions URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com'
    process.env.GITHUB_REPOSITORY = 'DataDog/dd-go'
    process.env.GITHUB_RUN_ID = '12345'
    delete process.env.CI_JOB_URL

    expect(getCiJobUrl()).toBe('https://github.com/DataDog/dd-go/actions/runs/12345')
  })

  it('returns GitLab CI URL', () => {
    delete process.env.GITHUB_SERVER_URL
    process.env.CI_JOB_URL = 'https://gitlab.com/group/project/-/jobs/999'

    expect(getCiJobUrl()).toBe('https://gitlab.com/group/project/-/jobs/999')
  })

  it('returns undefined when no CI env is set', () => {
    delete process.env.GITHUB_SERVER_URL
    delete process.env.GITHUB_REPOSITORY
    delete process.env.GITHUB_RUN_ID
    delete process.env.CI_JOB_URL

    expect(getCiJobUrl()).toBeUndefined()
  })
})

describe('formatComment', () => {
  it('formats a PASS comment', () => {
    const report: AgentReport = {
      result: 'PASS',
      explanation: 'Validated error handling paths. No regressions found.',
      findings: [],
      stats: {scenarios: 6, prod_inputs: 34},
    }

    const result = formatComment(report, undefined, 'https://ci.example.com/job/1')
    expect(result).toContain('<!-- datadog-ci-autotest -->')
    expect(result).toContain('## ✅ Autotest: PASS')
    expect(result).toContain('Validated error handling paths.')
    expect(result).toContain('📊 6 scenarios · 34 prod inputs')
    expect(result).toContain('[View full log](https://ci.example.com/job/1)')
    expect(result).toContain('Was this helpful? 👍 👎')
  })

  it('formats a FAIL comment for inline finding (no title)', () => {
    const finding: AgentFinding = {
      title: 'Error path broken',
      file: 'worker.go',
      line: 256,
      explanation: 'The || condition sends errors to the success path.',
    }
    const report: AgentReport = {
      result: 'FAIL',
      explanation: '',
      findings: [finding],
      stats: {scenarios: 6, prod_inputs: 34},
    }

    const result = formatComment(report, finding, 'https://ci.example.com/job/1')
    expect(result).toContain('## 🔴 Autotest: FAIL')
    expect(result).not.toContain('**Error path broken**')
    expect(result).toContain('The || condition sends errors to the success path.')
    expect(result).toContain('Was this helpful? 👍 👎')
  })

  it('formats a FAIL comment for non-inline finding (includes title)', () => {
    const finding: AgentFinding = {
      title: 'Missing retry logic',
      explanation: 'The new code path has no retry mechanism.',
    }
    const report: AgentReport = {
      result: 'FAIL',
      explanation: '',
      findings: [finding],
      stats: {scenarios: 3, prod_inputs: 0},
    }

    const result = formatComment(report, finding, undefined)
    expect(result).toContain('## 🔴 Autotest: FAIL')
    expect(result).toContain('**Missing retry logic**')
    expect(result).toContain('The new code path has no retry mechanism.')
    expect(result).not.toContain('View full log')
  })
})

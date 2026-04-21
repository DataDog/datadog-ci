import {parseAgentReport} from '../review'

describe('parseAgentReport', () => {
  it('parses a valid PASS report', () => {
    const text = `Some agent output text...

\`\`\`json
{
  "result": "PASS",
  "explanation": "Validated error handling in worker.go against 34 prod inputs.",
  "findings": [],
  "stats": { "scenarios": 6, "prod_inputs": 34 }
}
\`\`\``

    const report = parseAgentReport(text)
    expect(report).toEqual({
      result: 'PASS',
      explanation: 'Validated error handling in worker.go against 34 prod inputs.',
      findings: [],
      stats: {scenarios: 6, prod_inputs: 34},
    })
  })

  it('parses a FAIL report with file and line', () => {
    const text = `Analysis complete.

\`\`\`json
{
  "result": "FAIL",
  "explanation": "Found a logic error in error handling.",
  "findings": [
    {
      "title": "&&→|| silently turns errors into successes",
      "file": "worker.go",
      "line": 256,
      "explanation": "The new || condition sends errors to the success path."
    }
  ],
  "stats": { "scenarios": 6, "prod_inputs": 34 }
}
\`\`\``

    const report = parseAgentReport(text)
    expect(report).not.toBeUndefined()
    expect(report!.result).toBe('FAIL')
    expect(report!.findings).toHaveLength(1)
    expect(report!.findings[0].file).toBe('worker.go')
    expect(report!.findings[0].line).toBe(256)
  })

  it('parses a FAIL report without file/line', () => {
    const text = `\`\`\`json
{
  "result": "FAIL",
  "explanation": "Architectural issue found.",
  "findings": [
    {
      "title": "Missing retry logic",
      "explanation": "The new code path has no retry mechanism."
    }
  ],
  "stats": { "scenarios": 3, "prod_inputs": 0 }
}
\`\`\``

    const report = parseAgentReport(text)
    expect(report).not.toBeUndefined()
    expect(report!.findings[0].file).toBeUndefined()
    expect(report!.findings[0].line).toBeUndefined()
  })

  it('returns undefined when no JSON block is found', () => {
    const text = '## 🔬 Autotest: PASS\n\nNo issues found.'
    expect(parseAgentReport(text)).toBeUndefined()
  })

  it('returns undefined when JSON is malformed', () => {
    const text = '```json\n{ broken json }\n```'
    expect(parseAgentReport(text)).toBeUndefined()
  })
})

import {createMockContext, makeCli} from './fixtures'

describe('lambda flare', () => {
  it('prints non-dry-run header', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(['lambda', 'flare'], context as any)
    const output = context.stdout.toString()
    expect(code).toBe(1)
    expect(output).toMatchSnapshot()
  })

  it('prints dry-run header', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(['lambda', 'flare', '-d'], context as any)
    const output = context.stdout.toString()
    expect(code).toBe(1)
    expect(output).toMatchSnapshot()
  })

  it('prints error when no functions specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-r', 'us-west-2', '--api-key', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(1)
    const output = context.stdout.toString()
    expect(output).toContain('No functions specified. [-f,--function] or [--allFunctions]')
  })

  it('prints error when no region specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '--api-key', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(1)
    const output = context.stdout.toString()
    expect(output).toContain('No region specified. [-r,--region]')
  })

  it('prints error when no apiKey specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(1)
    const output = context.stdout.toString()
    expect(output).toContain('No API key specified. [--api-key]')
  })

  it('prints error when no email specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '--api-key', '123'], context as any)
    expect(code).toBe(1)
    const output = context.stdout.toString()
    expect(output).toContain('No email specified. [-e,--email]')
  })

  it('runs successfully with all required options specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '--api-key', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(0)
  })
})

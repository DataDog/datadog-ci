import {createMockContext, makeCli} from './fixtures'

describe('lambda flare', () => {
  it('prints non-dry-run header', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(['lambda', 'flare'], context as any)
    const output = context.stdout.toString()
    expect(code).toBe(0)
    expect(output).toMatchSnapshot()
  })

  it('prints dry-run header', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(['lambda', 'flare', '-d'], context as any)
    const output = context.stdout.toString()
    expect(code).toBe(0)
    expect(output).toMatchSnapshot()
  })
})

import {
  validateFlags,
  InteractiveCheckHandler,
  FunctionsCheckHandler,
  RegionCheckHandler,
  ApiKeyCheckHandler,
  EmailCheckHandler,
} from '../../flare-command-validator'

describe('FlagValidators', () => {
  test('InteractiveCheckHandler does not return an error message', () => {
    const handler = new InteractiveCheckHandler()
    expect(handler.handle({isInteractive: true})).toBeUndefined()
    expect(handler.handle({isInteractive: false, functions: []})).toBeUndefined()
  })

  test('FunctionsCheckHandler returns error if no functions are specified', () => {
    const handler = new FunctionsCheckHandler()
    expect(handler.handle({functions: []})).toBe('No functions specified. [-f,--function]')
    expect(handler.handle({functions: ['func1']})).toBeUndefined()
  })

  test('RegionCheckHandler returns error if no region is specified', () => {
    const handler = new RegionCheckHandler()
    expect(handler.handle({})).toBe('No region specified. [-r,--region]')
    expect(handler.handle({region: 'us-east-1'})).toBeUndefined()
  })

  test('ApiKeyCheckHandler returns error if no API key is specified', () => {
    const handler = new ApiKeyCheckHandler()
    expect(handler.handle({})).toBe('No API key specified. [--api-key]')
    expect(handler.handle({apiKey: 'someKey'})).toBeUndefined()
  })

  test('EmailCheckHandler returns error if no email is specified', () => {
    const handler = new EmailCheckHandler()
    expect(handler.handle({})).toBe('No email specified. [-e,--email]')
    expect(handler.handle({email: 'test@example.com'})).toBeUndefined()
  })

  describe('validateFlags', () => {
    test('returns undefined if the command is valid', () => {
      const flags = {
        isInteractive: true,
        functions: ['func1'],
        region: 'us-east-1',
        apiKey: 'someKey',
        email: 'test@example.com',
      }
      expect(validateFlags(flags)).toBeUndefined()
    })

    test('returns error if the command is not valid', () => {
      const flags = {
        isInteractive: false,
        functions: [],
      }
      expect(validateFlags(flags)).toBe('No functions specified. [-f,--function]')
    })
  })
})

import {
  validateFlags,
  InteractiveCheckValidator,
  FunctionsCheckValidator,
  RegionCheckValidator,
  ApiKeyCheckValidator,
  EmailCheckValidator,
} from '../../flare-command-validator'

describe('FlagValidators', () => {
  test('InteractiveCheckValidator does not return an error message', () => {
    const validator = new InteractiveCheckValidator()
    expect(validator.validate({isInteractive: true})).toBeUndefined()
    expect(validator.validate({isInteractive: false, functions: []})).toBeUndefined()
  })

  test('FunctionsCheckValidator returns error if no functions are specified', () => {
    const validator = new FunctionsCheckValidator()
    expect(validator.validate({functions: []})).toBe('No functions specified. [-f,--function]')
    expect(validator.validate({functions: ['func1']})).toBeUndefined()
  })

  test('RegionCheckValidator returns error if no region is specified', () => {
    const validator = new RegionCheckValidator()
    expect(validator.validate({})).toBe('No region specified. [-r,--region]')
    expect(validator.validate({region: 'us-east-1'})).toBeUndefined()
  })

  test('ApiKeyCheckValidator returns error if no API key is specified', () => {
    const validator = new ApiKeyCheckValidator()
    expect(validator.validate({})).toBe('No API key specified. [--api-key]')
    expect(validator.validate({apiKey: 'someKey'})).toBeUndefined()
  })

  test('EmailCheckValidator returns error if no email is specified', () => {
    const validator = new EmailCheckValidator()
    expect(validator.validate({})).toBe('No email specified. [-e,--email]')
    expect(validator.validate({email: 'test@example.com'})).toBeUndefined()
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

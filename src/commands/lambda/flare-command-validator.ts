// eslint-disable-next-line max-classes-per-file
abstract class FlagsValidatorValidator {
  // Uses the Chain of Responsibility design pattern to validate the command
  private nextValidator: FlagsValidatorValidator | undefined

  public setNext(validator: FlagsValidatorValidator): FlagsValidatorValidator {
    this.nextValidator = validator

    return validator
  }

  public validate(flags: {[key: string]: any}): string | undefined {
    if (this.nextValidator) {
      return this.nextValidator.validate(flags)
    }

    return undefined
  }
}

/**
 * Concrete validator for the interactive flag.
 * If the interactive flag is set, the other flags are not required.
 */
export class InteractiveCheckValidator extends FlagsValidatorValidator {
  public validate(flags: {[key: string]: any}): string | undefined {
    if (flags.isInteractive) {
      return undefined
    }

    return super.validate(flags)
  }
}

/**
 * Concrete validator for the functions flag.
 * Requires at least one function to be specified.
 */
export class FunctionsCheckValidator extends FlagsValidatorValidator {
  public validate(flags: {[key: string]: any}): string | undefined {
    if (flags.functions.length === 0) {
      return 'No functions specified. [-f,--function]'
    }

    return super.validate(flags)
  }
}

/**
 * Concrete validator for the region flag.
 * Requires a region to be specified.
 */
export class RegionCheckValidator extends FlagsValidatorValidator {
  public validate(flags: {[key: string]: any}): string | undefined {
    if (flags.region === undefined) {
      return 'No region specified. [-r,--region]'
    }

    return super.validate(flags)
  }
}

/**
 * Concrete validator for the API key flag.
 * Requires an API key to be specified.
 */
export class ApiKeyCheckValidator extends FlagsValidatorValidator {
  public validate(flags: {[key: string]: any}): string | undefined {
    if (flags.apiKey === undefined) {
      return 'No API key specified. [--api-key]'
    }

    return super.validate(flags)
  }
}

/**
 * Concrete validator for the email flag.
 * Requires an email to be specified.
 */
export class EmailCheckValidator extends FlagsValidatorValidator {
  public validate(flags: {[key: string]: any}): string | undefined {
    if (flags.email === undefined) {
      return 'No email specified. [-e,--email]'
    }

    return super.validate(flags)
  }
}

const interactiveCheckValidator = new InteractiveCheckValidator()
const functionsCheckValidator = new FunctionsCheckValidator()
const regionCheckValidator = new RegionCheckValidator()
const apiKeyCheckValidator = new ApiKeyCheckValidator()
const emailCheckValidator = new EmailCheckValidator()

interactiveCheckValidator
  .setNext(functionsCheckValidator)
  .setNext(regionCheckValidator)
  .setNext(apiKeyCheckValidator)
  .setNext(emailCheckValidator)

/**
 * @returns undefined if the command is valid, an error message otherwise.
 */
export const validateFlags = (flags: {[key: string]: any}): string | undefined => {
  return interactiveCheckValidator.validate(flags)
}

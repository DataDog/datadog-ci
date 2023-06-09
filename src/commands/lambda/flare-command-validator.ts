// eslint-disable-next-line max-classes-per-file
abstract class FlagsValidatorHandler {
  // Uses the Chain of Responsibility design pattern to validate the command
  private nextHandler: FlagsValidatorHandler | undefined

  public setNext(handler: FlagsValidatorHandler): FlagsValidatorHandler {
    this.nextHandler = handler

    return handler
  }

  public handle(flags: {[key: string]: any}): string | undefined {
    if (this.nextHandler) {
      return this.nextHandler.handle(flags)
    }

    return undefined
  }
}

/**
 * Concrete handler for the interactive flag.
 * If the interactive flag is set, the other flags are not required.
 */
export class InteractiveCheckHandler extends FlagsValidatorHandler {
  public handle(flags: {[key: string]: any}): string | undefined {
    if (flags.isInteractive) {
      return undefined
    }

    return super.handle(flags)
  }
}

/**
 * Concrete handler for the functions flag.
 * Requires at least one function to be specified.
 */
export class FunctionsCheckHandler extends FlagsValidatorHandler {
  public handle(flags: {[key: string]: any}): string | undefined {
    if (flags.functions.length === 0) {
      return 'No functions specified. [-f,--function]'
    }

    return super.handle(flags)
  }
}

/**
 * Concrete handler for the region flag.
 * Requires a region to be specified.
 */
export class RegionCheckHandler extends FlagsValidatorHandler {
  public handle(flags: {[key: string]: any}): string | undefined {
    if (flags.region === undefined) {
      return 'No region specified. [-r,--region]'
    }

    return super.handle(flags)
  }
}

/**
 * Concrete handler for the API key flag.
 * Requires an API key to be specified.
 */
export class ApiKeyCheckHandler extends FlagsValidatorHandler {
  public handle(flags: {[key: string]: any}): string | undefined {
    if (flags.apiKey === undefined) {
      return 'No API key specified. [--api-key]'
    }

    return super.handle(flags)
  }
}

/**
 * Concrete handler for the email flag.
 * Requires an email to be specified.
 */
export class EmailCheckHandler extends FlagsValidatorHandler {
  public handle(flags: {[key: string]: any}): string | undefined {
    if (flags.email === undefined) {
      return 'No email specified. [-e,--email]'
    }

    return super.handle(flags)
  }
}

const interactiveCheckHandler = new InteractiveCheckHandler()
const functionsCheckHandler = new FunctionsCheckHandler()
const regionCheckHandler = new RegionCheckHandler()
const apiKeyCheckHandler = new ApiKeyCheckHandler()
const emailCheckHandler = new EmailCheckHandler()

interactiveCheckHandler
  .setNext(functionsCheckHandler)
  .setNext(regionCheckHandler)
  .setNext(apiKeyCheckHandler)
  .setNext(emailCheckHandler)

/**
 * @returns undefined if the command is valid, an error message otherwise.
 */
export const validateFlags = (flags: {[key: string]: any}): string | undefined => {
  return interactiveCheckHandler.handle(flags)
}

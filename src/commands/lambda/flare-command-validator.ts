// Uses the Chain of Responsibility design pattern to validate the command
// eslint-disable-next-line max-classes-per-file
abstract class RequestHandler {
  private nextHandler: RequestHandler | undefined

  public setNext(handler: RequestHandler): RequestHandler {
    this.nextHandler = handler

    return handler
  }

  public handle(request: {[key: string]: any}): string | undefined {
    if (this.nextHandler) {
      return this.nextHandler.handle(request)
    }

    return undefined
  }
}

// Concrete handlers
class InteractiveCheckHandler extends RequestHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.isInteractive) {
      return undefined
    }

    return super.handle(request)
  }
}

class FunctionsCheckHandler extends RequestHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.functions.length === 0) {
      return 'No functions specified. [-f,--function]'
    }

    return super.handle(request)
  }
}

class RegionCheckHandler extends RequestHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.region === undefined) {
      return 'No region specified. [-r,--region]'
    }

    return super.handle(request)
  }
}

class ApiKeyCheckHandler extends RequestHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.apiKey === undefined) {
      return 'No API key specified. [--api-key]'
    }

    return super.handle(request)
  }
}

class EmailCheckHandler extends RequestHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.email === undefined) {
      return 'No email specified. [-e,--email]'
    }

    return super.handle(request)
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
export const validateCommand = (request: {[key: string]: any}): string | undefined => {
  return interactiveCheckHandler.handle(request)
}

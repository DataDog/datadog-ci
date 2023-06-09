abstract class AbstractHandler {
  private nextHandler: AbstractHandler | undefined

  public setNext(handler: AbstractHandler) {
    this.nextHandler = handler
  }

  public handle(request: {[key: string]: any}): string | undefined {
    if (this.nextHandler) {
      return this.nextHandler.handle(request)
    }

    return undefined
  }
}

class InteractiveHandler extends AbstractHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.isInteractive) {
      return undefined
    }

    return super.handle(request)
  }
}

class FunctionsHandler extends AbstractHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.functions.length === 0) {
      return 'No functions specified. [-f,--function]'
    }

    return super.handle(request)
  }
}

class RegionHandler extends AbstractHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.region === undefined) {
      return 'No region specified. [-r,--region]'
    }

    return super.handle(request)
  }
}

class ApiKeyHandler extends AbstractHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.apiKey === undefined) {
      return 'No API key specified. [--api-key]'
    }

    return super.handle(request)
  }
}

class EmailHandler extends AbstractHandler {
  public handle(request: {[key: string]: any}): string | undefined {
    if (request.email === undefined) {
      return 'No email specified. [-e,--email]'
    }

    return super.handle(request)
  }
}

const interactiveHandler = new InteractiveHandler()
const functionsHandler = new FunctionsHandler()
const regionHandler = new RegionHandler()
const apiKeyHandler = new ApiKeyHandler()
const emailHandler = new EmailHandler()

interactiveHandler.setNext(functionsHandler)
functionsHandler.setNext(regionHandler)
regionHandler.setNext(apiKeyHandler)
apiKeyHandler.setNext(emailHandler)

export const validateCommand = (request: {[key: string]: any}): string | undefined => {
  return interactiveHandler.handle(request)
}

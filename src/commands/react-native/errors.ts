export class NoCodepushReleaseError extends Error {
  constructor(appCenterAppName: string, appCenterDeployment: string) {
    super(`No codepush release has been created yet for ${appCenterAppName} ${appCenterDeployment}`)
  }
}

export class CodepushHistoryParseError extends Error {
  constructor(message?: string) {
    super(message)
  }
}

export class CodepushHistoryCommandError extends Error {
  constructor(message: string, command: string) {
    let errorMessage: string
    try {
      errorMessage = JSON.parse(message).errorMessage
      // Error returned when there is no network
      if (errorMessage.match('Cannot read properties of undefined')) {
        super(
          `You need to have network access to be able to get the latest codepush label.\nCheck that ${command} returns a correct value.\nAlternatively, you can directly use the "datadog-ci react-native upload" command to upload your sourcemaps with the correct release version.`
        )

        return
      }
    } catch (e) {
      errorMessage = message
    }

    super(errorMessage)
  }
}

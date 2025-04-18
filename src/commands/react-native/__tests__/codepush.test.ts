import {readFileSync} from 'fs'

import {Cli} from 'clipanion'

import {createMockContext, getEnvVarPlaceholders} from '../../../helpers/__tests__/testing-tools'

import {CodepushCommand} from '../codepush'

jest.mock('child_process', () => ({
  exec: jest.fn().mockImplementation((command: string, callback) => {
    const commandArgs = command.split(' ')
    const appNameIndex = commandArgs.findIndex((arg) => arg === '--app') + 1
    const appName = commandArgs[appNameIndex]
    let error
    let stdout
    let stderr
    if (appName === 'FakeOrg/FakeApp') {
      stdout = readFileSync(
        './src/commands/react-native/__tests__/fixtures/codepush-deployment-history/valid-deployment.txt'
      )
    } else if (appName === 'FakeOrg/FakeAppSemver') {
      stdout = readFileSync(
        './src/commands/react-native/__tests__/fixtures/codepush-deployment-history/valid-deployment-with-prefix-symbols.txt'
      )
    } else if (appName === 'FakeOrg/FakeAppInvalidVersion') {
      stdout = readFileSync(
        './src/commands/react-native/__tests__/fixtures/codepush-deployment-history/valid-deployment-with-invalid-version.txt'
      )
    } else if (appName === 'FakeOrg/NoNetwork') {
      error = `Error: Command failed: ${command}`
      stderr = readFileSync('./src/commands/react-native/__tests__/fixtures/codepush-deployment-history/no-network.txt')
    } else if (appName === 'FakeOrg/NoRelease') {
      stdout = readFileSync(
        './src/commands/react-native/__tests__/fixtures/codepush-deployment-history/no-release-for-deployment.txt'
      )
    } else if (appName === 'FakeOrg/WrongAppName') {
      error = `Error: Command failed: ${command}`
      stderr = readFileSync(
        './src/commands/react-native/__tests__/fixtures/codepush-deployment-history/wrong-app-name.txt'
      )
    } else if (appName === 'FakeOrg/WrongDeploymentName') {
      error = `Error: Command failed: ${command}`
      stderr = readFileSync(
        './src/commands/react-native/__tests__/fixtures/codepush-deployment-history/wrong-deployment-name.txt'
      )
    } else if (appName === 'FakeOrg/NotLoggedIn') {
      error = `Error: Command failed: ${command}`
      stderr = readFileSync(
        './src/commands/react-native/__tests__/fixtures/codepush-deployment-history/not-logged-in.txt'
      )
    } else {
      error = 'App name not mocked'
      stderr = `App name ${appName} is not registered in the tests, add it in the \`exec\` mock at the top of src/commands/react-native/__tests__/codepush.test.ts`
    }
    callback(error, stdout, stderr)
  }),
}))

const runCLI = async (appName: string, options?: {uploadBundle?: boolean}) => {
  const cli = new Cli()
  cli.register(CodepushCommand)

  const context = createMockContext()
  process.env = {...process.env, ...getEnvVarPlaceholders()}

  const command = [
    'react-native',
    'codepush',
    '--platform',
    'ios',
    '--service',
    'com.myapp',
    '--sourcemap',
    './src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map',
    '--app',
    appName,
    '--deployment',
    'Production',
    '--disable-git',
    '--dry-run',
  ]
  if (options?.uploadBundle !== false) {
    command.push('--bundle', './src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle')
  }

  const code = await cli.run(command, context)

  return {context, code}
}

describe('codepush', () => {
  describe('execute', () => {
    it('calls the upload command with a correct version number from the codepush history', async () => {
      const {context, code} = await runCLI('FakeOrg/FakeApp')
      // Uncomment these lines for debugging failing script
      // console.log(context.stdout.toString())
      // console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 1.0-codepush.v7 build: 1 service: com.myapp')
    })

    it('calls the upload command with a correct version number from the codepush history without bundle', async () => {
      const {context, code} = await runCLI('FakeOrg/FakeApp', {uploadBundle: false})
      // Uncomment these lines for debugging failing script
      // console.log(context.stdout.toString())
      // console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 1.0-codepush.v7 build: 1 service: com.myapp')
    })

    it('calls the upload command with a correct sanitized version number from the codepush history', async () => {
      const {context, code} = await runCLI('FakeOrg/FakeAppSemver')
      // Uncomment these lines for debugging failing script
      // console.log(context.stdout.toString())
      // console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 2.0-codepush.v7 build: 1 service: com.myapp')
    })

    it('calls the upload command with a correct sanitized version number from the codepush history without bundle', async () => {
      const {context, code} = await runCLI('FakeOrg/FakeAppSemver', {uploadBundle: false})
      // Uncomment these lines for debugging failing script
      // console.log(context.stdout.toString())
      // console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 2.0-codepush.v7 build: 1 service: com.myapp')
    })

    it('shows a meaningful error message when the version cannot be sanitized', async () => {
      const {context, code} = await runCLI('FakeOrg/FakeAppInvalidVersion', {uploadBundle: false})
      // Uncomment these lines for debugging failing script
      // console.log(context.stdout.toString())
      // console.log(context.stderr.toString())

      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toContain("Error parsing codepush history: invalid version string '#??0.0.1'")
    })

    it('shows a meaningful error message when no release has been made yet', async () => {
      const {context, code} = await runCLI('FakeOrg/NoRelease')
      // Uncomment these lines for debugging failing script
      // console.log(context.stdout.toString())
      // console.log(context.stderr.toString())

      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toContain('No codepush release has been created yet for FakeOrg/NoRelease Production')
    })

    it('shows a meaningful error message when user has no network', async () => {
      const {context, code} = await runCLI('FakeOrg/NoNetwork')
      // Uncomment these lines for debugging failing script
      // console.log(context.stdout.toString())
      // console.log(context.stderr.toString())

      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toContain('You need to have network access to be able to get the latest codepush label')
    })

    it('shows a meaningful error message when user is not logged in to appcenter', async () => {
      const {context, code} = await runCLI('FakeOrg/NotLoggedIn')
      // Uncomment these lines for debugging failing script
      // console.log(context.stdout.toString())
      // console.log(context.stderr.toString())

      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toContain(
        "Command 'appcenter codepush deployment history' requires a logged in user. Use the 'appcenter login' command to log in."
      )
    })

    it('shows a meaningful error message when user enters a non existing app name', async () => {
      const {context, code} = await runCLI('FakeOrg/WrongAppName')
      // Uncomment these lines for debugging failing script
      // console.log(context.stdout.toString())
      // console.log(context.stderr.toString())

      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toContain('The app FakeOrg/WrongAppName does not exist.')
    })
  })
})

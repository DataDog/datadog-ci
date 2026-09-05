import {isBrowserlessEnvironment, shouldOpenBrowser} from '../environment'

describe('browser environment detection', () => {
  test.each([
    ['Google Cloud Shell', {CLOUD_SHELL: 'true'}],
    ['AWS CloudShell execution env', {AWS_EXECUTION_ENV: 'AWSCloudShell'}],
    ['AWS CloudShell user', {AWS_CLOUDSHELL_USER_ID: 'user'}],
    ['Azure Cloud Shell', {ACC_CLOUD: 'true'}],
    ['Azure PowerShell host', {AZUREPS_HOST_ENVIRONMENT: 'cloud-shell'}],
    ['Codespaces', {CODESPACES: 'true'}],
    ['SSH', {SSH_CONNECTION: 'remote'}],
  ])('detects %s', (_, env) => {
    expect(isBrowserlessEnvironment(env, 'darwin')).toBe(true)
  })

  test('detects display-less Linux', () => {
    expect(isBrowserlessEnvironment({}, 'linux')).toBe(true)
    expect(isBrowserlessEnvironment({DISPLAY: ':0'}, 'linux')).toBe(false)
  })

  test('explicit preference overrides automatic detection', () => {
    const remote = {SSH_CONNECTION: 'remote'}
    expect(shouldOpenBrowser('always', remote)).toBe(true)
    expect(shouldOpenBrowser('never', {})).toBe(false)
    expect(shouldOpenBrowser('auto', remote)).toBe(false)
  })
})

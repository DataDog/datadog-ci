export type BrowserPreference = 'always' | 'auto' | 'never'

export const isBrowserlessEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean => {
  const awsCloudShell = env.AWS_CLOUDSHELL_USER_ID !== undefined || /cloudshell/i.test(env.AWS_EXECUTION_ENV || '')
  const remoteSession = Boolean(env.CLOUD_SHELL || awsCloudShell || env.ACC_CLOUD || env.AZUREPS_HOST_ENVIRONMENT)
  const codespaces = Boolean(env.CODESPACES || env.CODESPACE_NAME)
  const ssh = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY)
  const displaylessLinux = platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY

  return remoteSession || codespaces || ssh || displaylessLinux
}

export const shouldOpenBrowser = (preference: BrowserPreference, env = process.env): boolean =>
  preference === 'always' || (preference === 'auto' && !isBrowserlessEnvironment(env))

export const openBrowser = async (url: string): Promise<void> => {
  const {default: open} = await import('open')
  await open(url)
}

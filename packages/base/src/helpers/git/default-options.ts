export const DEFAULT_GIT_OPTIONS = {
  binary: 'git',
  // Preserve repository selection for checkouts with an external Git directory.
  allowEnvironment: ['GIT_DIR', 'GIT_WORK_TREE'],
}

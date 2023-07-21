import path from 'path'

export const MOCK_DATADOG_API_KEY = '02aeb762fff59ac0d5ad1536cd9633bd'
export const MOCK_CWD = 'mock-folder'
export const MOCK_FOLDER_PATH = path.join(MOCK_CWD, '.datadog-ci')

export const createMockContext = () => {
  let data = ''

  return {
    stdout: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
    stderr: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
  }
}

// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'standalone-e2e/tsconfig.json',
      },
    ],
  },
  roots: ['standalone-e2e'],
}

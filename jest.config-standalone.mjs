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

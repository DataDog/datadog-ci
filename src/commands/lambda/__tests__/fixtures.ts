import { Lambda } from 'aws-sdk'
import { Cli } from 'clipanion/lib/advanced'
import { InstrumentCommand } from '../instrument'

export const createMockContext = () => {
  let data = ''

  return {
    stdout: {
      toString: () => data,
      write: (input: string) => {
          data += input
      },
    },
  }
}

export const makeCli = () => {
  const cli = new Cli()
  cli.register(InstrumentCommand)

  return cli
}

export const createCommand = () => {
  const command = new InstrumentCommand()
  command.context = createMockContext() as any

  return command
}

export const makeMockLambda = (functionConfigs: Record<string, Lambda.FunctionConfiguration>) => ({
  getFunction: jest.fn().mockImplementation(({FunctionName}) => ({
    promise: () => Promise.resolve({Configuration: functionConfigs[FunctionName]}),
  })),
  listFunctions: jest.fn().mockImplementation(() => ({
    promise: () => Promise.resolve({Functions: Object.values(functionConfigs)}),
  })),
  listTags: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve({Tags: {}})})),
  tagResource: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
  updateFunctionConfiguration: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
})

export const makeMockCloudWatchLogs = () => ({})

export const mockAwsAccount = '123456789012'

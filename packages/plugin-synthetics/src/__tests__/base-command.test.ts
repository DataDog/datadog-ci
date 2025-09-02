import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {BaseCommand} from '../base-command'

import {mockReporter} from './fixtures'

class DummyCommand extends BaseCommand {
  public async execute() {
    await this.setup()

    this.reporter.log('Executing...')
  }

  protected async resolveConfig() {
    this.reporter.log('Resolving config...')
  }
}

describe('base-command', () => {
  test('reporter is first bootstrapped', async () => {
    const write = jest.fn()
    const command = createCommand(DummyCommand, {stdout: {write}})

    await command.execute()

    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenNthCalledWith(1, 'Resolving config...')
    expect(write).toHaveBeenNthCalledWith(2, 'Executing...')
  })

  test('reporter is updated after config resolution', async () => {
    const write = jest.fn()
    const command = createCommand(DummyCommand, {stdout: {write}})

    // e.g. mimic JUnit reporter being added after config resolution
    command['getReporters'] = () => [mockReporter]

    await command.execute()

    // Same as above (bootstrapped reporter)
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenNthCalledWith(1, 'Resolving config...')
    expect(write).toHaveBeenNthCalledWith(2, 'Executing...')

    // Mock reporter is also called
    expect(mockReporter.log).toHaveBeenCalledTimes(1)
    expect(mockReporter.log).toHaveBeenNthCalledWith(1, 'Executing...')
  })
})

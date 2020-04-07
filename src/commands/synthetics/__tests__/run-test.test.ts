// tslint:disable: no-string-literal
jest.mock('fs');
import * as fs from 'fs';

import { RunTestCommand } from '../run-test';
import * as utils from '../utils';

export const assertAsyncThrow = async (func: any, errorRegex?: RegExp) => {
  let error;
  try {
    await func();
    console.error('Function has not thrown');
  } catch (e) {
    error = e;
    if (errorRegex) {
      expect(e.toString()).toMatch(errorRegex);
    }
  }

  expect(error).toBeTruthy();

  return error;
};

describe('run-test', () => {
  describe('getAppBaseURL', () => {
    test('should default to datadog us', async () => {
      process.env = { };
      const command = new RunTestCommand();

      expect(command['getAppBaseURL']()).toBe('https://app.datadoghq.com/');
    });

    test('subdomain should be overridable', async () => {
      process.env = { DATADOG_SUBDOMAIN: 'custom' };
      const command = new RunTestCommand();

      expect(command['getAppBaseURL']()).toBe('https://custom.datadoghq.com/');
    });

    test('should override subdomain and site', async () => {
      process.env = { DATADOG_SITE: 'datadoghq.eu', DATADOG_SUBDOMAIN: 'custom' };
      const command = new RunTestCommand();

      expect(command['getAppBaseURL']()).toBe('https://custom.datadoghq.eu/');
    });
  });

  describe('getDatadogHost', () => {
    test('should default to datadog us api', async () => {
      process.env = { };
      const command = new RunTestCommand();

      expect(command['getDatadogHost']()).toBe('https://api.datadoghq.com/api/v1/');
      expect(command['getDatadogHost'](true)).toBe('https://intake.synthetics.datadoghq.com/api/v1/');
    });

    test('should be tunable through DATADOG_SITE variable', async () => {
      process.env = { DATADOG_SITE: 'datadoghq.eu' };
      const command = new RunTestCommand();

      expect(command['getDatadogHost']()).toBe('https://api.datadoghq.eu/api/v1/');
      expect(command['getDatadogHost'](true)).toBe('https://api.datadoghq.eu/api/v1/');
    });
  });

  describe('getApiHelper', () => {
    test('should throw an error if API or Application key are undefined', async () => {
      process.env = { };
      const write = jest.fn();
      const command = new RunTestCommand();
      command.context = { stdout: { write } } as any;

      await assertAsyncThrow(command['getApiHelper'].bind(command), /API and\/or Application keys are missing/);
      expect(write.mock.calls[0][0]).toContain('DATADOG_APP_KEY');
      expect(write.mock.calls[1][0]).toContain('DATADOG_API_KEY');

      command['appKey'] = 'fakeappkey';

      write.mockClear();
      await assertAsyncThrow(command['getApiHelper'].bind(command), /API and\/or Application keys are missing/);
      expect(write.mock.calls[0][0]).toContain('DATADOG_API_KEY');
    });
  });

  describe('parseConfigFile', () => {
    test('should read a config file', async () => {
      (fs.readFile as any).mockImplementation((path: string, opts: any, callback: any) =>
        callback(undefined, '{"newconfigkey":"newconfigvalue"}'));

      const command = new RunTestCommand();

      await command['parseConfigFile']();
      expect((command['config'] as any)['newconfigkey']).toBe('newconfigvalue');
      (fs.readFile as any).mockRestore();
    });

    test('should throw an error if path is provided and config file is not found', async () => {
      (fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({ code: 'ENOENT'}));
      const command = new RunTestCommand();
      command['configPath'] = '/veryuniqueandabsentfile';

      await assertAsyncThrow(command['parseConfigFile'].bind(command), /Config file not found/);
    });

    test('should throw an error if JSON parsing fails', async () => {
      (fs.readFile as any).mockImplementation((p: string, o: any, cb: any) => cb(undefined, 'thisisnoJSON'));
      const command = new RunTestCommand();

      await assertAsyncThrow(command['parseConfigFile'].bind(command), /Config file is not correct JSON/);
    });
  });

  describe('getTestsToTrigger', () => {
    test('should find all tests and extend global config', async () => {
      const conf1 = {
        tests: [ { config: { }, id: 'abc-def-ghi' } ],
      };
      const conf2 = {
        tests: [ { config: { }, id: 'jkl-mno-pqr' } ],
      };
      const startUrl = 'fakeUrl';
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [conf1, conf2]) as any);
      const command = new RunTestCommand();
      command.context = process;
      command['config'].global = { startUrl };

      expect(await command['getTestsToTrigger'].bind(command)()).toEqual([
        {
          config: { startUrl },
          id: 'abc-def-ghi',
        },
        {
          config: { startUrl },
          id: 'jkl-mno-pqr',
        },
      ]);
    });
  });
});

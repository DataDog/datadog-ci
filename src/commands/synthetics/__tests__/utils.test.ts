jest.mock('glob');
jest.mock('fs');
jest.useFakeTimers();

import * as fs from 'fs';

import * as axios from 'axios';
import glob from 'glob';

import { apiConstructor } from '../api';
import { getSuites, runTests } from '../utils';

describe('utils', () => {
  describe('getSuites', () => {
    const GLOB = 'testGlob';
    const FILES = [ 'file1', 'file2' ];
    const FILES_CONTENT = { file1: '{"content":"file1"}', file2: '{"content":"file2"}' };

    (fs.readFile as any).mockImplementation((path: 'file1' | 'file2', opts: any, callback: any) =>
      callback(undefined, FILES_CONTENT[path]));
    (glob as any).mockImplementation((query: string, callback: (e: any, v: any) => void) => callback(undefined, FILES));

    test('should get suites', async () => {
      const suites = await getSuites(GLOB, process.stdout.write.bind(process.stdout));
      expect(JSON.stringify(suites)).toBe(`[${FILES_CONTENT.file1},${FILES_CONTENT.file2}]`);
    });
  });

  describe('runTest', () => {
    const api = apiConstructor({ apiKey: '123', appKey: '123', baseUrl: 'base' });
    const processWrite = process.stdout.write.bind(process.stdout);
    const fakeTest = {
      name: 'Fake Test',
      public_id: '123-456-789',
    };
    const fakeTrigger = {
      results: [],
      triggered_check_ids: [fakeTest.public_id],
    };
    jest.spyOn(axios.default, 'create').mockImplementation((() => (e: any) => {
      if (e.url === '/synthetics/tests/trigger/ci') {
        return { data: fakeTrigger };
      }

      if (e.url === `/synthetics/tests/${fakeTest.public_id}`) {
        return { data: fakeTest };
      }
    }) as any);

    test('should run test', async () => {
      const output = await runTests(api, [{ id: fakeTest.public_id, config: { } }], processWrite);
      expect(output).toEqual({ tests: [fakeTest], triggers: fakeTrigger });
    });

    test('should run test with publicId from url', async () => {
      const output = await runTests(
        api, [{
          config: { },
          id: `http://localhost/synthetics/tests/details/${fakeTest.public_id}`,
        }],
        processWrite
      );
      expect(output).toEqual({ tests: [fakeTest], triggers: fakeTrigger });
    });
  });
});

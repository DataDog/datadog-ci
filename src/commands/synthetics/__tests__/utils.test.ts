jest.mock('glob');
jest.useFakeTimers();

import * as fs from 'fs';

import glob from 'glob';
import request from 'request-promise-native';

import { apiConstructor } from '../api';
import { getSuites, runTest } from '../utils';

describe('utils', () => {
  describe('getSuites', () => {
    const GLOB = 'testGlob';
    const FILES = [ 'file1', 'file2' ];
    const FILES_CONTENT = { file1: '{"content":"file1"}', file2: '{"content":"file2"}' };

    jest.spyOn(fs.promises, 'readFile').mockImplementation(path =>
      Promise.resolve(FILES_CONTENT[path as 'file1' | 'file2'])
    );

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
    jest.spyOn(request, 'defaults').mockImplementation((() => (e: request.RequestPromise) => {
      if (e.uri as any === '/synthetics/tests/trigger/ci') {
        return fakeTrigger;
      }

      if (e.uri as any === `/synthetics/tests/${fakeTest.public_id}`) {
        return fakeTest;
      }
    }) as any);

    test('should run test', async () => {
      const output = await runTest(api, { id: fakeTest.public_id, config: { } }, processWrite);
      expect(output).toEqual([fakeTest, fakeTrigger.results]);
    });

    test('should run test with publicId from url', async () => {
      const output = await runTest(
        api, {
          config: { },
          id: `http://localhost/synthetics/tests/details/${fakeTest.public_id}`,
        },
        processWrite
      );
      expect(output).toEqual([fakeTest, fakeTrigger.results]);
    });
  });
});

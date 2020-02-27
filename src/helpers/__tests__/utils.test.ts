import { handleQuit, pick, stopIntervals } from '../utils';
jest.useFakeTimers();

describe('utils', () => {
  describe('handleQuit', () => {
    const CALLS = [
      'exit',
      'SIGINT',
      'SIGUSR1',
      'SIGUSR2',
      'uncaughtException',
    ];
    const processMock = jest.spyOn(process, 'on').mockImplementation();
    test('should call stop on every quit events', () => {
      const stop = jest.fn();
      handleQuit(stop);
      expect(processMock).toHaveBeenCalledTimes(CALLS.length);
      CALLS.forEach(call => {
        expect(processMock).toHaveBeenCalledWith(call, stop);
      });
    });
  });

  test('should call clearInterval and clearTimeout', () => {
    const timeout = setTimeout(jest.fn(), 0);
    const interval = setInterval(jest.fn(), 0);
    stopIntervals(interval, timeout);
    expect(clearInterval).toHaveBeenCalledWith(interval);
    expect(clearTimeout).toHaveBeenCalledWith(timeout);
  });

  test('Test pick', () => {
    const initialHash = { a: 1, b: 2 };

    let resultHash = pick(initialHash, ['a']);
    expect(Object.keys(resultHash).indexOf('b')).toBe(-1);
    expect(resultHash.a).toBe(1);

    resultHash = pick(initialHash, ['c'] as any);
    expect(Object.keys(resultHash).length).toBe(0);
  });
});

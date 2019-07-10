jest.mock('commander');
describe('index', () => {
  describe('environment keys', () => {
    afterEach(() => {
      delete process.exitCode;
    });

    test('it should exit without the right keys', () => {
      require('../index');
      expect(process.exitCode).toBe(1);
    });

    test('it should not exit with the right keys', () => {
      require('commander')._mockParam('appKey', '123');
      require('commander')._mockParam('apiKey', '123');
      require('../index');
      expect(process.exitCode).toBeUndefined();
    });
  });
});

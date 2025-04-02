export const testSkipWindows = process.platform === 'win32' ? test.skip : test

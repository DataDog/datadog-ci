// Forbid writing to stdout and stderr in unit tests.
// The clipanion context should always be used, and in unit tests it should be mocked with `createMockContext()`.

let spyOut
let spyErr

beforeEach(() => {
  spyOut = jest.spyOn(process.stdout, 'write')
  spyErr = jest.spyOn(process.stderr, 'write')
})

afterEach(() => {
  expect(spyOut.mock.calls).toStrictEqual([])
  expect(spyErr.mock.calls).toStrictEqual([])
})

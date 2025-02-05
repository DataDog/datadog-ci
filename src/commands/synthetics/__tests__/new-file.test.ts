test('foo', () => {
  expect('foo').toBe('foo')
})

// eslint-disable-next-line jest/no-identical-title
test('foo', () => {
  expect('foo').toBe('foo')
})

test('bar', () => {
  expect('bar').toBe('bar')
})

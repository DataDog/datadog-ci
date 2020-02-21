import * as helpers from '../../src/helpers/utils';

test('Test pick', () => {
  const initialHash = { a: 1, b: 2 };

  let resultHash = helpers.pick(initialHash, ['a']);
  expect(Object.keys(resultHash).indexOf('b')).toBe(-1);
  expect(resultHash.a).toBe(1);

  resultHash = helpers.pick(initialHash, ['c'] as any);
  expect(Object.keys(resultHash).length).toBe(0);
});

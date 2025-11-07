/* eslint-disable no-null/no-null */
import {generateConfigDiff, parseEnvVars, sortedEqual} from '@datadog/datadog-ci-base/helpers/serverless/common'

describe('generateConfigDiff', () => {
  test('should generate correct diffs for various config changes', () => {
    const original = {volumes: [], port: 8080}
    const updated = {
      volumes: [
        {
          name: 'shared-volume',
          emptyDir: {
            medium: 1,
          },
        },
      ],
      port: 8080,
    }

    const expected = `  {
    "port": 8080,
-   "volumes": []
+   "volumes": [
+     {
+       "emptyDir": {
+         "medium": 1
+       },
+       "name": "shared-volume"
+     }
+   ]
  }`
    const result = generateConfigDiff(original, updated)
    expect(result).toContain(expected)
  })

  test('should return "No changes detected" for identical objects', () => {
    const config = {name: 'test', port: 8080}
    const result = generateConfigDiff(config, config)
    expect(result).toContain('No changes detected.')
  })

  test('should handle objects with different key ordering', () => {
    const original = {b: 2, a: 1}
    const updated = {a: 1, b: 2}
    const result = generateConfigDiff(original, updated)
    expect(result).toContain('No changes detected.')
  })

  test('should obfuscate sensitive values', () => {
    const original = {api_key: 'abc123'}
    const updated = {api_key: '1234567890abcdef1234567890abcdef'}
    const result = generateConfigDiff(original, updated)
    expect(result).toContain('***')
    expect(result).not.toContain('1234567890abcdef1234567890abcdef')
  })
})

describe('sortedEqual', () => {
  test('should return true for identical primitive values', () => {
    expect(sortedEqual(1, 1)).toBe(true)
    expect(sortedEqual('test', 'test')).toBe(true)
    expect(sortedEqual(true, true)).toBe(true)
  })

  test('should return false for different primitive values', () => {
    expect(sortedEqual(1, 2)).toBe(false)
    expect(sortedEqual('test', 'other')).toBe(false)
    expect(sortedEqual(true, false)).toBe(false)
  })

  test('should return true for arrays with same elements', () => {
    expect(sortedEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(sortedEqual(['a', 'b'], ['a', 'b'])).toBe(true)
  })

  test('should return false for arrays with different elements', () => {
    expect(sortedEqual([1, 2, 3], [1, 2, 4])).toBe(false)
    expect(sortedEqual([1, 2], [1, 2, 3])).toBe(false)
  })

  test('should return true for objects with same properties regardless of order', () => {
    expect(sortedEqual({a: 1, b: 2}, {b: 2, a: 1})).toBe(true)
    expect(sortedEqual({x: 'test', y: 123}, {y: 123, x: 'test'})).toBe(true)
  })

  test('should return false for objects with different properties', () => {
    expect(sortedEqual({a: 1, b: 2}, {a: 1, b: 3})).toBe(false)
    expect(sortedEqual({a: 1}, {a: 1, b: 2})).toBe(false)
  })

  test('should handle nested objects', () => {
    expect(sortedEqual({a: {b: 1}}, {a: {b: 1}})).toBe(true)
    expect(sortedEqual({a: {b: 1}}, {a: {b: 2}})).toBe(false)
  })

  test('should handle null and undefined', () => {
    expect(sortedEqual(null, null)).toBe(true)
    expect(sortedEqual(undefined, undefined)).toBe(true)
    expect(sortedEqual(null, undefined)).toBe(false)
  })

  test('should return true for arrays of primitives in different order', () => {
    expect(sortedEqual([3, 1, 2], [1, 2, 3])).toBe(true)
    expect(sortedEqual(['c', 'a', 'b'], ['a', 'b', 'c'])).toBe(true)
  })

  test('should return true for arrays of objects with same content', () => {
    expect(sortedEqual([{id: 1}, {id: 2}], [{id: 2}, {id: 1}])).toBe(true)
    expect(sortedEqual([{a: 1, b: 2}, {c: 3}], [{c: 3}, {b: 2, a: 1}])).toBe(true)
  })

  test('should return false for arrays of objects with different content', () => {
    expect(sortedEqual([{id: 1}, {id: 2}], [{id: 1}, {id: 3}])).toBe(false)
  })

  test('should handle mixed type arrays', () => {
    expect(sortedEqual([1, 'test', {a: 1}], [{a: 1}, 'test', 1])).toBe(true)
    expect(sortedEqual([null, 1, 'test'], ['test', 1, null])).toBe(true)
  })

  test('should return false for mixed type arrays with different values', () => {
    expect(sortedEqual([1, 'test', {a: 1}], [1, 'test', {a: 2}])).toBe(false)
  })

  test('should handle deeply nested structures', () => {
    const obj1 = {a: [1, {b: [2, 3]}, 4], c: {d: 5}}
    const obj2 = {c: {d: 5}, a: [4, {b: [3, 2]}, 1]}
    expect(sortedEqual(obj1, obj2)).toBe(true)
  })

  test('should handle arrays with duplicate values', () => {
    expect(sortedEqual([1, 2, 2, 3], [3, 2, 1, 2])).toBe(true)
    expect(sortedEqual([1, 2, 2], [1, 2, 2, 2])).toBe(false)
  })
})

describe('parseEnvVars', () => {
  test('should parse simple key=value pairs', () => {
    const envVars = ['KEY1=value1', 'KEY2=value2']
    const result = parseEnvVars(envVars)
    expect(result).toEqual({KEY1: 'value1', KEY2: 'value2'})
  })

  test('should handle empty array', () => {
    const result = parseEnvVars([])
    expect(result).toEqual({})
  })

  test('should handle values with equals signs', () => {
    const envVars = ['KEY=value=with=equals']
    const result = parseEnvVars(envVars)
    expect(result).toEqual({KEY: 'value=with=equals'})
  })

  test('should handle empty values', () => {
    const envVars = ['KEY=']
    const result = parseEnvVars(envVars)
    expect(result).toEqual({KEY: ''})
  })

  test('should skip invalid entries without equals sign', () => {
    const envVars = ['VALID=value', 'INVALID', 'ANOTHER=test']
    const result = parseEnvVars(envVars)
    expect(result).toEqual({VALID: 'value', ANOTHER: 'test'})
  })

  test('should handle special characters in values', () => {
    const envVars = ['KEY=value with spaces', 'PATH=/usr/bin:/bin']
    const result = parseEnvVars(envVars)
    expect(result).toEqual({KEY: 'value with spaces', PATH: '/usr/bin:/bin'})
  })

  test('should overwrite duplicate keys with last value', () => {
    const envVars = ['KEY=first', 'KEY=second']
    const result = parseEnvVars(envVars)
    expect(result).toEqual({KEY: 'second'})
  })
})

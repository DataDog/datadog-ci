import {generateConfigDiff} from '../utils'

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
    \"port\": 8080,
-   \"volumes\": []
+   \"volumes\": [
+     {
+       \"emptyDir\": {
+         \"medium\": 1
+       },
+       \"name\": \"shared-volume\"
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

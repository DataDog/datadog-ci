export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SITE || process.env.DD_SITE) {
    return `https://quality-gates.${process.env.DATADOG_SITE || process.env.DD_SITE}`
  }

  return 'https://quality-gates.datadoghq.com'
}

/**
 * Receives an array of the form ['key:value', 'key2:value2_1', 'key2:value2_2']
 * and returns an object of the form {key: ['value'], key2: ['value2_1, value2_2']}
 */
export const parseScope = (scope: string[]) => {
  try {
    return scope.reduce((acc: {[key: string]: string[]}, keyValuePair) => {
      if (!keyValuePair.includes(':')) {
        return acc
      }

      const firstColon = keyValuePair.indexOf(':')
      const key = keyValuePair.substring(0, firstColon)
      const value = keyValuePair.substring(firstColon + 1)

      if (acc.hasOwnProperty(key)) {
        if (!acc[key].includes(value)) {
          acc[key].push(value)
        }
      } else {
        acc[key] = [value]
      }

      return acc
    }, {})
  } catch (e) {
    return {}
  }
}

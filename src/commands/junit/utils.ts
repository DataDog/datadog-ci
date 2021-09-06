export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SITE || process.env.DD_SITE) {
    return `https://cireport-intake.${process.env.DATADOG_SITE || process.env.DD_SITE}`
  }

  return 'https://cireport-intake.datadoghq.com'
}

/**
 * Receives an array of the form ['key:value', 'key2:value2']
 * and returns an object of the form {key: 'value', key2: 'value2'}
 */
export const parseTags = (tags: string[]) => {
  try {
    return tags.reduce((acc, keyValuePair) => {
      if (!keyValuePair.includes(':')) {
        return acc
      }
      const [key, value] = keyValuePair.split(':')

      return {
        ...acc,
        [key]: value,
      }
    }, {})
  } catch (e) {
    return {}
  }
}

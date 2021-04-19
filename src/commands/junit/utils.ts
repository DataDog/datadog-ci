export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SITE) {
    return 'https://cireport-http-intake.logs.' + process.env.DATADOG_SITE
  }

  return 'https://cireport-http-intake.logs.datadoghq.com'
}

export const parseTags = (cliTags: string | undefined) => {
  if (!cliTags) {
    return {}
  }
  try {
    return cliTags.split(',').reduce((acc, keyValuePair) => {
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

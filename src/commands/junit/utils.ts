export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SITE) {
    return 'https://cireport-http-intake.logs.' + process.env.DATADOG_SITE
  }

  return 'https://cireport-http-intake.logs.datadoghq.com'
}

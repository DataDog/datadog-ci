export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SOURCEMAP_INTAKE_URL) {
    return process.env.DATADOG_SOURCEMAP_INTAKE_URL
  } else if (process.env.DATADOG_SITE) {
    return 'https://sourcemap-intake.' + process.env.DATADOG_SITE
  }

  return 'https://sourcemap-intake.datadoghq.com'
}

export const getBaseSourcemapIntakeUrl = (datadogSite?: string) => {
  if (process.env.DATADOG_SOURCEMAP_INTAKE_URL) {
    return process.env.DATADOG_SOURCEMAP_INTAKE_URL
  } else if (datadogSite) {
    return 'https://sourcemap-intake.' + datadogSite
  }

  return 'https://sourcemap-intake.datadoghq.com'
}

export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SITE || process.env.DD_SITE) {
    return `https://cireport-intake.${process.env.DATADOG_SITE || process.env.DD_SITE}`
  }

  return 'https://cireport-intake.datadoghq.com'
}

export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SITE || process.env.DD_SITE) {
    return `https://quality-gates.${process.env.DATADOG_SITE || process.env.DD_SITE}`
  }

  return 'https://quality-gates.datadoghq.com'
}

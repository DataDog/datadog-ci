export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SITE || process.env.DD_SITE) {
    return `https://cicodescan-intake.${process.env.DATADOG_SITE || process.env.DD_SITE}`
  }

  return 'https://cicodescan-intake.datadoghq.com'
}

import fs from 'fs'

export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SITE || process.env.DD_SITE) {
    return `https://cicodescan-intake.${process.env.DATADOG_SITE || process.env.DD_SITE}`
  }

  return 'https://cicodescan-intake.datadoghq.com'
}

export const TAG_DATADOG_TYPE_TYPE_STATIC = 'DATADOG_RULE_TYPE:STATIC_ANALYSIS'
export const TAG_DATADOG_TYPE_TYPE_SECRET = 'DATADOG_RULE_TYPE:SECRET'
export const SERVICE_DATADOG_ANALYZER = 'datadog-analyzer'
export const SERVICE_DATADOG_ANALYZER_SA_ONLY = 'datadog-analyzer-sa-only'
export const SERVICE_DATADOG_ANALYZER_SECRETS_ONLY = 'datadog-analyzer-secrets-only'
export const SERVICE_THIRD_PARTY_ANALYZER = 'third-party-analyzer'

/**
 * Define the service and env based on the SARIF contents reports
 *  - if the report is produced by the datadog static analyzer, we look if the report
 *    contains only static analysis or secrets errors and change service
 *  - if the report is produced by a third party tool, we report it as is and cannot
 *    infer the nature of the results. We still try to get the first tool from the runs.
 *
 *  The objective of this function is to make sure that if a user uploads one report
 *  for static analysis only and one report for secrets only, they will have a different
 *  service and env for each report so that they are not discarded later in our backend.
 *
 * @param filePath
 */
export const getServiceFromSarifTool = (filePath: string): string => {
  let otherTool: string = SERVICE_THIRD_PARTY_ANALYZER
  const ruleTypes: Set<string> = new Set()
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const report: any = JSON.parse(String(fs.readFileSync(filePath)))

    if ('runs' in report) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      for (const run of report['runs']) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if ('tool' in run && 'driver' in run['tool'] && 'rules' in run['tool']['driver']) {
          for (const rule of run['tool']['driver']['rules']) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if ('properties' in rule && 'tags' in rule['properties']) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              for (const tag of rule['properties']['tags']) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
                if (tag.includes('DATADOG_RULE_TYPE')) {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                  ruleTypes.add(tag)
                }
              }
            }
          }
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment
    otherTool = report['runs'][0]['tool']['driver']['name']
  } catch (error) {
    // ignore
  }

  if (ruleTypes.has(TAG_DATADOG_TYPE_TYPE_STATIC) && ruleTypes.has(TAG_DATADOG_TYPE_TYPE_SECRET)) {
    return SERVICE_DATADOG_ANALYZER
  }

  if (ruleTypes.has(TAG_DATADOG_TYPE_TYPE_STATIC) && !ruleTypes.has(TAG_DATADOG_TYPE_TYPE_SECRET)) {
    return SERVICE_DATADOG_ANALYZER_SA_ONLY
  }

  if (!ruleTypes.has(TAG_DATADOG_TYPE_TYPE_STATIC) && ruleTypes.has(TAG_DATADOG_TYPE_TYPE_SECRET)) {
    return SERVICE_DATADOG_ANALYZER_SECRETS_ONLY
  }

  return otherTool
}

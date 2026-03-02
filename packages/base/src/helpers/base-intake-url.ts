import {getIntakeUrl} from './api'

export const getBaseSourcemapIntakeUrl = (datadogSite?: string) =>
  getIntakeUrl('sourcemap-intake', {overrideEnvVar: 'DATADOG_SOURCEMAP_INTAKE_URL', site: datadogSite})

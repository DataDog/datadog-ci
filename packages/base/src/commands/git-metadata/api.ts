import {getDatadogSite, getIntakeUrl} from '../../helpers/api'

export const datadogSite = getDatadogSite()

export const apiHost = 'api.' + datadogSite

export const getBaseIntakeUrl = () => getIntakeUrl('sourcemap-intake', {overrideEnvVar: 'DATADOG_SOURCEMAP_INTAKE_URL'})

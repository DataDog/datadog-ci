import {getDatadogSite, getIntakeUrl} from '../../helpers/api'
import {getApiHostForSite} from '../../helpers/utils'

export {getDatadogSite}

export const datadogSite = getDatadogSite()

export const apiHost = getApiHostForSite(datadogSite)

export const getBaseIntakeUrl = () => getIntakeUrl('sourcemap-intake', {overrideEnvVar: 'DATADOG_SOURCEMAP_INTAKE_URL'})

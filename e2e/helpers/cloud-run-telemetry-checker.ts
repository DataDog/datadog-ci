import {checkTelemetryFlowing as checkE2ETelemetryFlowing} from './telemetry-checker'

export const checkTelemetryFlowing = async (serviceName: string): Promise<void> => {
  await checkE2ETelemetryFlowing({serviceName})
}

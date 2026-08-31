import type {IService} from './types'
import type {ServicesClient} from '@google-cloud/run'

import {generateConfigDiff, sortedEqual} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {protos} from '@google-cloud/run'

export interface ServiceUpdatePreview {
  diff: string
  hasChanges: boolean
}

/** Validates an update without applying it and compares the server-normalized configuration. */
export const previewServiceUpdate = async (
  client: ServicesClient,
  existingService: IService,
  updatedService: IService
): Promise<ServiceUpdatePreview> => {
  const [operation] = await client.updateService({service: updatedService, validateOnly: true})
  const existingPreview = normalizeService(existingService)
  const updatedPreview = normalizeService(operation.metadata as IService)

  return {
    diff: generateConfigDiff(existingPreview, updatedPreview),
    hasChanges: !sortedEqual(existingPreview, updatedPreview),
  }
}

const normalizeService = (service: IService): unknown => {
  const serviceType = protos.google.cloud.run.v2.Service
  const mutableConfig = {
    labels: service.labels,
    launchStage: service.launchStage,
    template: service.template,
  }
  const canonicalService = serviceType.toObject(serviceType.fromObject(mutableConfig), {
    enums: Number,
    longs: String,
  })

  return removeProtoDefaults(canonicalService)
}

const removeProtoDefaults = (value: unknown): unknown => {
  if (!value) {
    return undefined
  }
  if (Array.isArray(value)) {
    const values = value.map(removeProtoDefaults).filter((item) => item !== undefined)

    return values.length === 0 ? undefined : values
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, removeProtoDefaults(item)] as const)
      .filter(([, item]) => item !== undefined)

    return entries.length === 0 ? undefined : Object.fromEntries(entries)
  }

  return value
}

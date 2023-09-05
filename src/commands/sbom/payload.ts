import os from 'os'

import {SpanTags} from '../../helpers/interfaces'

import {Bom} from './protobuf/bom-1.4'
import {SBOMEntity, SBOMPayload, SBOMSourceType} from './protobuf/sbom_intake'
import {SbomPayloadData} from './types'

export const generatePayload = (payloadData: SbomPayloadData, service: string, tags: SpanTags): SBOMPayload => {
  const spanTagsAsStringArray = Object.keys(tags).map((key) => `${key}:${tags[key as keyof SpanTags]}`)

  return SBOMPayload.create({
    host: os.hostname(),
    source: 'CI',
    entities: [
      SBOMEntity.create({
        id: service,
        type: SBOMSourceType.CI_PIPELINE,
        inUse: true,
        generatedAt: new Date(),
        ddTags: spanTagsAsStringArray,
        cyclonedx: Bom.fromJSON(payloadData.content),
      }),
    ],
  })
}

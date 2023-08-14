/* eslint-disable */
import * as _m0 from 'protobufjs/minimal'
import {Bom} from './bom-1.4'
import {Duration} from './google/protobuf/duration'
import {Timestamp} from './google/protobuf/timestamp'

export const protobufPackage = 'appsecpb'

export enum SBOMSourceType {
  UNSPECIFIED = 0,
  CONTAINER_IMAGE_LAYERS = 1,
  CONTAINER_FILE_SYSTEM = 2,
  HOST_FILE_SYSTEM = 3,
  UNRECOGNIZED = -1,
}

export function sBOMSourceTypeFromJSON(object: any): SBOMSourceType {
  switch (object) {
    case 0:
    case 'UNSPECIFIED':
      return SBOMSourceType.UNSPECIFIED
    case 1:
    case 'CONTAINER_IMAGE_LAYERS':
      return SBOMSourceType.CONTAINER_IMAGE_LAYERS
    case 2:
    case 'CONTAINER_FILE_SYSTEM':
      return SBOMSourceType.CONTAINER_FILE_SYSTEM
    case 3:
    case 'HOST_FILE_SYSTEM':
      return SBOMSourceType.HOST_FILE_SYSTEM
    case -1:
    case 'UNRECOGNIZED':
    default:
      return SBOMSourceType.UNRECOGNIZED
  }
}

export function sBOMSourceTypeToJSON(object: SBOMSourceType): string {
  switch (object) {
    case SBOMSourceType.UNSPECIFIED:
      return 'UNSPECIFIED'
    case SBOMSourceType.CONTAINER_IMAGE_LAYERS:
      return 'CONTAINER_IMAGE_LAYERS'
    case SBOMSourceType.CONTAINER_FILE_SYSTEM:
      return 'CONTAINER_FILE_SYSTEM'
    case SBOMSourceType.HOST_FILE_SYSTEM:
      return 'HOST_FILE_SYSTEM'
    case SBOMSourceType.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

/** SBOMPayload represents the main SBOM payload */
export interface SBOMPayload {
  version: number
  host: string
  /** use to know the source of the message: agent, other */
  source?: string | undefined
  entities: SBOMEntity[]
  ddEnv?: string | undefined
}

export interface SBOMEntity {
  type: SBOMSourceType
  /** Unique identifier to be able to correlated and "deduplicate" SBOM */
  id: string
  /** datadog tags that will be added by the agent depending of the SBOMSourceType */
  ddTags: string[]
  /** the datetime of the SBOM generation */
  generatedAt?: Date | undefined
  /** the tags of the container image */
  repoTags: string[]
  /** Whether the SBOM concerns a running entity (running container) or an inert entity (image not used by any container) */
  inUse: boolean
  /** SBOM generation duration (how long it took to generate the SBOM report) */
  generationDuration?: Duration | undefined
  /** only cyclonedx will be supported initially but putting it optional will allow us to move to another format later */
  cyclonedx?: Bom | undefined
}

function createBaseSBOMPayload(): SBOMPayload {
  return {version: 0, host: '', source: undefined, entities: [], ddEnv: undefined}
}

// @ts-ignore
export const SBOMPayload = {
  encode(message: SBOMPayload, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.version !== 0) {
      writer.uint32(8).int32(message.version)
    }
    if (message.host !== '') {
      writer.uint32(18).string(message.host)
    }
    if (message.source !== undefined) {
      writer.uint32(26).string(message.source)
    }
    for (const v of message.entities) {
      SBOMEntity.encode(v!, writer.uint32(34).fork()).ldelim()
    }
    if (message.ddEnv !== undefined) {
      writer.uint32(42).string(message.ddEnv)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SBOMPayload {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseSBOMPayload()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.version = reader.int32()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.host = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.source = reader.string()
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.entities.push(SBOMEntity.decode(reader, reader.uint32()))
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.ddEnv = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): SBOMPayload {
    return {
      version: isSet(object.version) ? Number(object.version) : 0,
      host: isSet(object.host) ? String(object.host) : '',
      source: isSet(object.source) ? String(object.source) : undefined,
      entities: Array.isArray(object?.entities) ? object.entities.map((e: any) => SBOMEntity.fromJSON(e)) : [],
      ddEnv: isSet(object.ddEnv) ? String(object.ddEnv) : undefined,
    }
  },

  toJSON(message: SBOMPayload): unknown {
    const obj: any = {}
    if (message.version !== 0) {
      obj.version = Math.round(message.version)
    }
    if (message.host !== '') {
      obj.host = message.host
    }
    if (message.source !== undefined) {
      obj.source = message.source
    }
    if (message.entities?.length) {
      obj.entities = message.entities.map((e) => SBOMEntity.toJSON(e))
    }
    if (message.ddEnv !== undefined) {
      obj.ddEnv = message.ddEnv
    }
    return obj
  },

  create<I extends Exact<DeepPartial<SBOMPayload>, I>>(base?: I): SBOMPayload {
    return SBOMPayload.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<SBOMPayload>, I>>(object: I): SBOMPayload {
    const message = createBaseSBOMPayload()
    message.version = object.version ?? 0
    message.host = object.host ?? ''
    message.source = object.source ?? undefined
    message.entities = object.entities?.map((e) => SBOMEntity.fromPartial(e)) || []
    message.ddEnv = object.ddEnv ?? undefined
    return message
  },
}

function createBaseSBOMEntity(): SBOMEntity {
  return {
    type: 0,
    id: '',
    ddTags: [],
    generatedAt: undefined,
    repoTags: [],
    inUse: false,
    generationDuration: undefined,
    cyclonedx: undefined,
  }
}

// @ts-ignore
export const SBOMEntity = {
  encode(message: SBOMEntity, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.type !== 0) {
      writer.uint32(8).int32(message.type)
    }
    if (message.id !== '') {
      writer.uint32(18).string(message.id)
    }
    for (const v of message.ddTags) {
      writer.uint32(58).string(v!)
    }
    if (message.generatedAt !== undefined) {
      Timestamp.encode(toTimestamp(message.generatedAt), writer.uint32(26).fork()).ldelim()
    }
    for (const v of message.repoTags) {
      writer.uint32(34).string(v!)
    }
    if (message.inUse === true) {
      writer.uint32(40).bool(message.inUse)
    }
    if (message.generationDuration !== undefined) {
      Duration.encode(message.generationDuration, writer.uint32(50).fork()).ldelim()
    }
    if (message.cyclonedx !== undefined) {
      Bom.encode(message.cyclonedx, writer.uint32(82).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): SBOMEntity {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseSBOMEntity()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.type = reader.int32() as any
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.id = reader.string()
          continue
        case 7:
          if (tag !== 58) {
            break
          }

          message.ddTags.push(reader.string())
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.generatedAt = fromTimestamp(Timestamp.decode(reader, reader.uint32()))
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.repoTags.push(reader.string())
          continue
        case 5:
          if (tag !== 40) {
            break
          }

          message.inUse = reader.bool()
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.generationDuration = Duration.decode(reader, reader.uint32())
          continue
        case 10:
          if (tag !== 82) {
            break
          }

          message.cyclonedx = Bom.decode(reader, reader.uint32())
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): SBOMEntity {
    return {
      type: isSet(object.type) ? sBOMSourceTypeFromJSON(object.type) : 0,
      id: isSet(object.id) ? String(object.id) : '',
      ddTags: Array.isArray(object?.ddTags) ? object.ddTags.map((e: any) => String(e)) : [],
      generatedAt: isSet(object.generatedAt) ? fromJsonTimestamp(object.generatedAt) : undefined,
      repoTags: Array.isArray(object?.repoTags) ? object.repoTags.map((e: any) => String(e)) : [],
      inUse: isSet(object.inUse) ? Boolean(object.inUse) : false,
      generationDuration: isSet(object.generationDuration) ? Duration.fromJSON(object.generationDuration) : undefined,
      cyclonedx: isSet(object.cyclonedx) ? Bom.fromJSON(object.cyclonedx) : undefined,
    }
  },

  toJSON(message: SBOMEntity): unknown {
    const obj: any = {}
    if (message.type !== 0) {
      obj.type = sBOMSourceTypeToJSON(message.type)
    }
    if (message.id !== '') {
      obj.id = message.id
    }
    if (message.ddTags?.length) {
      obj.ddTags = message.ddTags
    }
    if (message.generatedAt !== undefined) {
      obj.generatedAt = message.generatedAt.toISOString()
    }
    if (message.repoTags?.length) {
      obj.repoTags = message.repoTags
    }
    if (message.inUse === true) {
      obj.inUse = message.inUse
    }
    if (message.generationDuration !== undefined) {
      obj.generationDuration = Duration.toJSON(message.generationDuration)
    }
    if (message.cyclonedx !== undefined) {
      obj.cyclonedx = Bom.toJSON(message.cyclonedx)
    }
    return obj
  },

  create<I extends Exact<DeepPartial<SBOMEntity>, I>>(base?: I): SBOMEntity {
    return SBOMEntity.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<SBOMEntity>, I>>(object: I): SBOMEntity {
    const message = createBaseSBOMEntity()
    message.type = object.type ?? 0
    message.id = object.id ?? ''
    message.ddTags = object.ddTags?.map((e) => e) || []
    message.generatedAt = object.generatedAt ?? undefined
    message.repoTags = object.repoTags?.map((e) => e) || []
    message.inUse = object.inUse ?? false
    message.generationDuration =
      object.generationDuration !== undefined && object.generationDuration !== null
        ? Duration.fromPartial(object.generationDuration)
        : undefined
    message.cyclonedx =
      object.cyclonedx !== undefined && object.cyclonedx !== null ? Bom.fromPartial(object.cyclonedx) : undefined
    return message
  },
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined

export type DeepPartial<T> = T extends Builtin
  ? T
  : T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U>
  ? ReadonlyArray<DeepPartial<U>>
  : T extends {}
  ? {[K in keyof T]?: DeepPartial<T[K]>}
  : Partial<T>

type KeysOfUnion<T> = T extends T ? keyof T : never
export type Exact<P, I extends P> = P extends Builtin
  ? P
  : P & {[K in keyof P]: Exact<P[K], I[K]>} & {[K in Exclude<keyof I, KeysOfUnion<P>>]: never}

function toTimestamp(date: Date): Timestamp {
  const seconds = date.getTime() / 1_000
  const nanos = (date.getTime() % 1_000) * 1_000_000
  return {seconds, nanos}
}

function fromTimestamp(t: Timestamp): Date {
  let millis = (t.seconds || 0) * 1_000
  millis += (t.nanos || 0) / 1_000_000
  return new Date(millis)
}

function fromJsonTimestamp(o: any): Date {
  if (o instanceof Date) {
    return o
  } else if (typeof o === 'string') {
    return new Date(o)
  } else {
    return fromTimestamp(Timestamp.fromJSON(o))
  }
}

function isSet(value: any): boolean {
  return value !== null && value !== undefined
}

export type RecordWithKebabCaseKeys = {
  [K in string as Lowercase<K>]: unknown
}

export type UUIDv4 = () => string
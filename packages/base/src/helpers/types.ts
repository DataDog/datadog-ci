export type RecordWithKebabCaseKeys = {
  [K in string as Lowercase<K>]: unknown
}

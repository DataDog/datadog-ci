// This is the existing intake event discriminator. It describes the payload
// contract and does not restrict the standalone command to Flutter projects.
export const TYPE_WASM_SOURCEMAP = 'flutter_wasm_sourcemap'
export const VALUE_NAME_SOURCE_MAP = 'source_map'
export const SOURCE_MAP_FILE_NAME = 'source_map'

export interface WasmSourcemapFile {
  modulePath: string
  moduleUrl: string
  sourcemapPath: string
}

export interface WasmSourcemapMetadata {
  cli_version: string
  minified_url: string
  service: string
  type: string
  version: string
}

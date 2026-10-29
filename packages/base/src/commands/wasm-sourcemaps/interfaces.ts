// Must match sourcemap-processor's WASM source map intake discriminator.
export const TYPE_WASM_SOURCEMAP = 'wasm_sourcemap'
export const VALUE_NAME_SOURCE_MAP = 'source_map'
export const SOURCE_MAP_FILE_NAME = 'source_map'

export interface WasmSourcemapFile {
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

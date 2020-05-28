export interface Payload {
    service: string
    version: string
    minifiedUrl: string
    minifiedFilePath: string
    sourcemapPath: string
    project_path?: string
    overwrite?: boolean
}

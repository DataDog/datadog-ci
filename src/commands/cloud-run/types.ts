// XXX temporary type definitions for @google-cloud/run
// TODO remove this when google-auth-library ESM/CJS issues are fixed

export interface IEnvVar {
  name: string
  value: string
}

export interface IVolumeMount {
  name?: string
  mountPath?: string
}

export interface IContainer {
  name?: string
  image?: string
  env?: IEnvVar[]
  volumeMounts?: IVolumeMount[]
  startupProbe?: any
  resources?: any
}

export interface IVolume {
  name?: string
  emptyDir?: {
    medium?: number
  }
}

export interface IServiceTemplate {
  containers?: IContainer[]
  volumes?: IVolume[]
  revision?: string | undefined
}

export interface IService {
  name?: string
  uid?: string
  uri?: string
  description?: string
  template?: IServiceTemplate
  labels?: Record<string, string>
}

export interface ServicesClient {
  servicePath: (project: string, region: string, service: string) => string
  getService: (request: {name: string}) => Promise<[IService]>
  updateService: (request: {service: IService}) => Promise<[any]>
}

export interface RevisionsClient {
  servicePath: (project: string, region: string, service: string) => string
  listRevisions: (request: {parent: string}) => Promise<[any[]]>
}

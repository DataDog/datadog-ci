import {ServicesClient} from '@google-cloud/run'

type LastOverload<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : never

type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

export type IService = Prettify<
  NonNullable<Parameters<Parameters<LastOverload<InstanceType<typeof ServicesClient>['getService']>>[1]>[1]>
>

export type IServiceTemplate = Prettify<NonNullable<IService['template']>>

export type IVolume = Prettify<NonNullable<IServiceTemplate['volumes']>[number]>

export type IContainer = Prettify<NonNullable<IServiceTemplate['containers']>[number]>

export type IEnvVar = Prettify<NonNullable<IContainer['env']>[number]>

export type IVolumeMount = Prettify<NonNullable<IContainer['volumeMounts']>[number]>

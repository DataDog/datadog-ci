import type {LambdaConfig} from './commands/lambda/schema'
import type {SyntheticsConfig} from './commands/synthetics/schema'

export type DatadogCiConfig = {
  lambda?: LambdaConfig
  synthetics?: SyntheticsConfig
}

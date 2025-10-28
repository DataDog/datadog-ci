import {
  LambdaClient,
  ListTagsCommandInput,
  TagResourceCommandInput,
  UntagResourceCommandInput,
  TagResourceCommand,
  UntagResourceCommand,
  ListTagsCommand,
} from '@aws-sdk/client-lambda'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'

import {TagConfiguration} from './interfaces'

export const applyTagConfig = async (lambdaClient: LambdaClient, config: TagConfiguration): Promise<void> => {
  const {tagResourceCommandInput, untagResourceCommandInput} = config
  if (tagResourceCommandInput !== undefined) {
    await tagResource(lambdaClient, tagResourceCommandInput)
  }
  if (untagResourceCommandInput !== undefined) {
    await untagResource(lambdaClient, untagResourceCommandInput)
  }
}

export const tagResource = async (client: LambdaClient, input: TagResourceCommandInput): Promise<void> => {
  const command = new TagResourceCommand(input)
  await client.send(command)
}

export const untagResource = async (client: LambdaClient, input: UntagResourceCommandInput): Promise<void> => {
  const command = new UntagResourceCommand(input)
  await client.send(command)
}

export const calculateTagUpdateRequest = async (
  lambdaClient: LambdaClient,
  functionARN: string
): Promise<TagConfiguration | undefined> => {
  const config: TagConfiguration = {}

  const versionTagPresent = await hasVersionTag(lambdaClient, functionARN)

  if (!versionTagPresent) {
    config.tagResourceCommandInput = {
      Resource: functionARN,
      Tags: {
        [SERVERLESS_CLI_VERSION_TAG_NAME]: SERVERLESS_CLI_VERSION_TAG_VALUE,
      },
    }

    return config
  }

  return
}

export const calculateTagRemoveRequest = async (
  lambdaClient: LambdaClient,
  functionARN: string
): Promise<TagConfiguration | undefined> => {
  const config: TagConfiguration = {}
  const versionTagPresent = await hasVersionTag(lambdaClient, functionARN)
  if (versionTagPresent) {
    config.untagResourceCommandInput = {
      Resource: functionARN,
      TagKeys: [SERVERLESS_CLI_VERSION_TAG_NAME],
    }

    return config
  }

  return
}

export const hasVersionTag = async (client: LambdaClient, functionARN: string): Promise<boolean> => {
  const input: ListTagsCommandInput = {
    Resource: functionARN,
  }
  const command = new ListTagsCommand(input)
  const response = await client.send(command)
  const {Tags} = response

  return Tags !== undefined && Tags[SERVERLESS_CLI_VERSION_TAG_NAME] === SERVERLESS_CLI_VERSION_TAG_VALUE
}

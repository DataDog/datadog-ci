import {Lambda} from 'aws-sdk'
import path from 'path'
import {TAG_VERSION_NAME} from './constants'
// tslint:disable-next-line
const {version} = require(path.join(__dirname, '../../../package.json'))

export interface TagConfiguration {
  tagResourceRequest?: Lambda.TagResourceRequest
}

export const applyTagConfig = async (lambda: Lambda, configuration: TagConfiguration) => {
  const {tagResourceRequest} = configuration
  if (tagResourceRequest !== undefined) {
    await lambda.tagResource(tagResourceRequest).promise()
  }
}

export const calculateTagUpdateRequest = async (lambda: Lambda, functionARN: string) => {
  const config: TagConfiguration = {}

  const versionTagPresent = await hasVersionTag(lambda, functionARN)

  if (!versionTagPresent) {
    config.tagResourceRequest = {
      Resource: functionARN,
      Tags: {
        [TAG_VERSION_NAME]: `v${version}`,
      },
    }

    return config
  }

  return
}

export const hasVersionTag = async (lambda: Lambda, functionARN: string): Promise<boolean> => {
  const args = {
    Resource: functionARN,
  }
  const result = await lambda.listTags(args).promise()
  const {Tags} = result

  return Tags !== undefined && Tags[TAG_VERSION_NAME] === `v${version}`
}

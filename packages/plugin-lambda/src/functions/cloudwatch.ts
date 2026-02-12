import {DeleteRolePolicyCommand, GetRolePolicyCommand, IAMClient, PutRolePolicyCommand} from '@aws-sdk/client-iam'
import {GetFunctionCommand, LambdaClient} from '@aws-sdk/client-lambda'

export const DENY_POLICY_NAME = 'DenyCloudWatchLogs'

export const getDenyPolicyDocument = (logGroups: string[]) =>
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Deny',
        Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: logGroups.map((lg) => `arn:aws:logs:*:*:log-group:${lg}:*`),
      },
    ],
  })

export const getFunctionDetails = async (
  lambdaClient: LambdaClient,
  functionIdentifier: string
): Promise<{roleName: string; functionName: string; logGroup: string}> => {
  const resp = await lambdaClient.send(new GetFunctionCommand({FunctionName: functionIdentifier}))
  const roleArn = resp.Configuration?.Role
  if (!roleArn) {
    throw new Error(`Could not determine execution role for function ${functionIdentifier}`)
  }

  const functionName = resp.Configuration?.FunctionName
  if (!functionName) {
    throw new Error(`Could not determine function name for ${functionIdentifier}`)
  }

  // Role ARN format: arn:aws:iam::ACCOUNT:role/ROLE_NAME or arn:aws:iam::ACCOUNT:role/path/ROLE_NAME
  const roleName = roleArn.split('/').pop()!
  const logGroup = resp.Configuration?.LoggingConfig?.LogGroup ?? `/aws/lambda/${functionName}`

  return {roleName, functionName, logGroup}
}

const LOG_GROUP_RESOURCE_PATTERN = /^arn:aws:logs:\*:\*:log-group:(.+):\*$/

export const getExistingDeniedLogGroups = async (iamClient: IAMClient, roleName: string): Promise<string[]> => {
  try {
    const resp = await iamClient.send(
      new GetRolePolicyCommand({
        RoleName: roleName,
        PolicyName: DENY_POLICY_NAME,
      })
    )
    const doc = JSON.parse(decodeURIComponent(resp.PolicyDocument!))
    const resource = doc.Statement?.[0]?.Resource
    if (!resource) {
      return []
    }
    const resources: string[] = Array.isArray(resource) ? resource : [resource]

    return resources.map((r) => LOG_GROUP_RESOURCE_PATTERN.exec(r)?.[1]).filter((lg): lg is string => lg !== undefined)
  } catch (err) {
    if (err instanceof Error && err.name === 'NoSuchEntityException') {
      return []
    }
    throw err
  }
}

export const disableCloudwatchLogs = async (
  iamClient: IAMClient,
  roleName: string,
  logGroups: string[]
): Promise<void> => {
  const existing = await getExistingDeniedLogGroups(iamClient, roleName)
  const merged = [...new Set([...existing, ...logGroups])]
  await iamClient.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: DENY_POLICY_NAME,
      PolicyDocument: getDenyPolicyDocument(merged),
    })
  )
}

export const enableCloudwatchLogs = async (
  iamClient: IAMClient,
  roleName: string,
  logGroups: string[]
): Promise<void> => {
  const existing = await getExistingDeniedLogGroups(iamClient, roleName)
  const remaining = existing.filter((lg) => !logGroups.includes(lg))

  if (remaining.length === 0) {
    try {
      await iamClient.send(
        new DeleteRolePolicyCommand({
          RoleName: roleName,
          PolicyName: DENY_POLICY_NAME,
        })
      )
    } catch (err) {
      if (err instanceof Error && err.name === 'NoSuchEntityException') {
        return
      }
      throw err
    }
  } else {
    await iamClient.send(
      new PutRolePolicyCommand({
        RoleName: roleName,
        PolicyName: DENY_POLICY_NAME,
        PolicyDocument: getDenyPolicyDocument(remaining),
      })
    )
  }
}

import {DeleteRolePolicyCommand, IAMClient, PutRolePolicyCommand} from '@aws-sdk/client-iam'
import {GetFunctionCommand, LambdaClient} from '@aws-sdk/client-lambda'

export const DENY_POLICY_NAME = 'DenyCloudWatchLogs'

export const getDenyPolicyDocument = (functionNames: string[]) =>
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Deny',
        Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: functionNames.map((fn) => `arn:aws:logs:*:*:log-group:/aws/lambda/${fn}:*`),
      },
    ],
  })

export const getFunctionDetails = async (
  lambdaClient: LambdaClient,
  functionIdentifier: string
): Promise<{roleName: string; functionName: string}> => {
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

  return {roleName, functionName}
}

export const disableCloudwatchLogs = async (
  iamClient: IAMClient,
  roleName: string,
  functionNames: string[]
): Promise<void> => {
  await iamClient.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: DENY_POLICY_NAME,
      PolicyDocument: getDenyPolicyDocument(functionNames),
    })
  )
}

export const enableCloudwatchLogs = async (
  iamClient: IAMClient,
  roleName: string,
  _functionNames: string[]
): Promise<void> => {
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
}

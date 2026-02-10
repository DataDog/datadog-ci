import {DeleteRolePolicyCommand, IAMClient, PutRolePolicyCommand} from '@aws-sdk/client-iam'
import {GetFunctionCommand, LambdaClient} from '@aws-sdk/client-lambda'

export const DENY_CLOUDWATCH_POLICY_NAME = 'DenyCloudWatchLogs'

export const DENY_CLOUDWATCH_POLICY_DOCUMENT = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Deny',
      Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      Resource: '*',
    },
  ],
})

export const getRoleName = async (lambdaClient: LambdaClient, functionName: string): Promise<string> => {
  const resp = await lambdaClient.send(new GetFunctionCommand({FunctionName: functionName}))
  const roleArn = resp.Configuration?.Role
  if (!roleArn) {
    throw new Error(`Could not determine execution role for function ${functionName}`)
  }

  // Role ARN format: arn:aws:iam::ACCOUNT:role/ROLE_NAME or arn:aws:iam::ACCOUNT:role/path/ROLE_NAME
  const roleName = roleArn.split('/').pop()!

  return roleName
}

export const disableCloudwatchLogs = async (iamClient: IAMClient, roleName: string): Promise<void> => {
  await iamClient.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: DENY_CLOUDWATCH_POLICY_NAME,
      PolicyDocument: DENY_CLOUDWATCH_POLICY_DOCUMENT,
    })
  )
}

export const enableCloudwatchLogs = async (iamClient: IAMClient, roleName: string): Promise<void> => {
  try {
    await iamClient.send(
      new DeleteRolePolicyCommand({
        RoleName: roleName,
        PolicyName: DENY_CLOUDWATCH_POLICY_NAME,
      })
    )
  } catch (err: any) {
    // If the policy doesn't exist, that's fine — it's already enabled
    if (err.name === 'NoSuchEntityException') {
      return
    }
    throw err
  }
}

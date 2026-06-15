# Lambda E2E Test Infrastructure

CI creates an ephemeral AWS Lambda function per run and deletes it afterward. The test runs in `eu-central-1` by default with the `nodejs24.x` runtime.

## Local Setup

Install the AWS CLI and `zip`, then configure AWS credentials with access to the test account.

Create `e2e/.env.local`:

```bash
DATADOG_CI_COMMAND='yarn launch'
AWS_REGION=eu-central-1
AWS_LAMBDA_EXECUTION_ROLE_ARN=<role arn>
DATADOG_API_KEY=<datadog api key>
```

`DD_API_KEY` can be used instead of `DATADOG_API_KEY`.

Run the Lambda e2e test:

```bash
yarn jest --config jest.config-e2e.js e2e/lambda.test.ts --runInBand
```

## AWS Roles

The Lambda execution role set in `AWS_LAMBDA_EXECUTION_ROLE_ARN` needs a trust policy for `lambda.amazonaws.com`. Attach `AWSLambdaBasicExecutionRole` if the function is invoked manually.

The GitHub Actions OIDC role set in `AWS_ROLE_ARN_E2E` needs these permissions:

```json
{
  "Effect": "Allow",
  "Action": [
    "lambda:CreateFunction",
    "lambda:DeleteFunction",
    "lambda:GetFunction",
    "lambda:GetFunctionConfiguration",
    "lambda:ListTags",
    "lambda:TagResource",
    "lambda:UntagResource",
    "lambda:UpdateFunctionConfiguration"
  ],
  "Resource": "arn:aws:lambda:eu-central-1:<account id>:function:dd-ci-lambda-*"
}
```

The GitHub Actions OIDC role also needs `iam:PassRole` on the Lambda execution role.

## GitHub Actions variables

| Variable | Value |
|----------|-------|
| `AWS_ROLE_ARN_E2E` | OIDC role assumed by GitHub Actions |
| `AWS_LAMBDA_EXECUTION_ROLE_ARN_E2E` | Execution role used by ephemeral Lambda functions |

# Trace command

Trace your CI commands.

**Warning**: this command is still in alpha and should not be used in production environments.

## Usage

### Setup

You need the [Datadog Agent](https://docs.datadoghq.com/agent/) running in your environment.

#### Commands

The available command is:

- `command`: trace your command

```bash
datadog-ci trace command yarn test
```

```bash
datadog-ci trace command mkdir artifacts
```

Whatever command comes after `datadog-ci trace command` will be executed as is. A span that represents the executed command will be created.

### Supported CIs

You may use `trace command` in any CI, but the created span will only be a part of a pipeline trace in the following supported CIs:

- Jenkins. [Datadog Jenkins Plugin](https://docs.datadoghq.com/integrations/jenkins/) v2.4.0 or higher needs to be installed.

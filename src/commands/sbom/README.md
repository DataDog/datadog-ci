# SBOM uploader

This command lets you upload SBOM file to the Datadog intake endpoint.

**WARNING**: this command is in beta mode. Please do not use it in production today and you need 
to set `DD_BETA_COMMANDS_ENABLED=1` to make it run.


## Supported Formats

 - CycloneDX 1.4

## Usage

```bash
DD_BETA_COMMANDS_ENABLED=1 datadog-ci sbom upload --service <my-service> <path/to/sbom.json>
```

### Environment variables

The following environment variables must be defined

 - `DD_SITE`: the [Datadog site](https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site)
 - `DD_APP_KEY`: the App Key to use
 - `DD_API_KEY`: the API key to use
 - `DD_SERVICE`: the Datadog service you use (if `--service` not specified)

## Development

### Generate Intake definition

First, install protobuf CLI:


```bash
brew install protobuf
``

Then, install `ts-proto` as a development dependency on your laptop.
You can find information about this binary [here](https://github.com/stephenh/ts-proto).


Finally, generate the TypeScript definition of the protobuf format as this.

```bash
protoc --proto_path=./src/commands/sbom/protobuf/  --plugin=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=src/commands/sbom/protobuf/ ./src/commands/sbom/protobuf/bom-1.4.proto
```

```bash
protoc --proto_path=./src/commands/sbom/protobuf/  --plugin=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=src/commands/sbom/protobuf/ ./src/commands/sbom/protobuf/sbom_intake.proto
```

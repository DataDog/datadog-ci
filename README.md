# synthetics-ci
Run Synthetics tests from your CI.

## Usage

### Setup

You need to either have `DD_API_KEY` and `DD_APP_KEY` in your environment or pass them to the CLI.
```bash
# Environment setup
export DD_API_KEY="<DATADOG_API_KEY>"
export DD_APP_KEY="<DATADOG_APPLICATION_KEY>"

# Passing to CLI
synthetics --apiKey "<DATADOG_API_KEY>" --appKey "<DATADOG_APPLICATION_KEY>"
```

### API

By default it runs at the root of the working folder and finds `{,!(node_modules)/**/}*.synthetics.json` files (every files ending with `.synthetics.json` except those in the `node_modules` folder).

You can pass options to the CLI too.

```bash
Usage: synthetics [options]

Options:
  --appKey   [appKey]    Application Key
  --apiKey   [apiKey]    API Key
  --apiUrl   [url]       API URL (default: "https://dd.datad0g.com/api/v1")
  --files    [files]     Files to include (default: "{,!(node_modules)/**/}*.synthetics.json")
  --timeout  [timeout]   Timeout in ms (default: 2 minutes)
  --config   [file]      Path to config file
```

#### Configuration

You can use many different format of configuration file, [more info in the **rc** Github repository](https://github.com/dominictarr/rc#standards).

For instance with a JSON file `synthetics-config.json`:

```json
{
    "apiKey": "<DATADOG_API_KEY>",
    "appKey": "<DATADOG_APPLICATION_KEY>",
    "apiUrl": "https://app.datadoghq.com/api/v1",
    "files": "{,!(node_modules)/**/}*.synthetics.json",
    "global": {
        "startUrl": "{{URL}}?test_param=synthetics"
    },
    "timeout": 220000
}
```

Then run:

```bash
yarn synthetics --config ./synthetics-config.json
```

### Test files

Your test files must be named with a `.synthetics.json` suffix.

```json
// myTest.synthetics.json
{
    "tests": [
        {
            "id": "<TEST_PUBLIC_ID>",
            "config": {
                "allowInsecureCertificates": true,
                "basicAuth": { username: "test", password: "test" },
                "deviceIds": ["laptop_large"],
                "followRedirects": true,
                "headers": { "NEW_HEADER": "NEW VALUE" },
                "locations": ["aws:us-east-1"],
                "skip": true,
                "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}",
                "variables": { "titleVariable": "new title" },
            }
        }
    ]
}
```

You can configure on which url your test starts by providing a `config.startUrl` to your test object and build your own starting url using any part of your test's original starting url and the following environment variables: 

| Environment variable | Description                  | Example                                                |
|----------------------|------------------------------|--------------------------------------------------------|
| `URL`                | Test's original starting url | `https://www.example.org:81/path/to/something?abc=123` |
| `DOMAIN`             | Test's domain name           | `example.org`                                          |
| `HOST`               | Test's host                  | `www.example.org:81`                                   |
| `HOSTNAME`           | Test's hostname              | `www.example.org`                                      |
| `ORIGIN`             | Test's origin                | `https://www.example.org:81`                           |
| `PARAMS`             | Test's query parameters      | `?abc=123`                                             |
| `PATHNAME`           | Test's URl path              | `/path/to/something`                                   |
| `PORT`               | Test's host port             | `81`                                                   |
| `PROTOCOL`           | Test's protocol              | `https:`                                               |
| `SUBDOMAIN`          | Test's sub domain            | `www`                                                  |

For instance, if your test's starting url is `https://www.example.org:81/path/to/something?abc=123`

It can be written as :

* `{{PROTOCOL}}//{{SUBDOMAIN}}.{{DOMAIN}}:{{PORT}}{{PATHNAME}}{{PARAMS}}`
* `{{PROTOCOL}}//{{HOST}}{{PATHNAME}}{{PARAMS}}`
* `{{URL}}`

and so on...

## Development

```bash
# Compile and watch
yarn watch

# Run the tests
yarn jest

# Build code
yarn build

# Format code
yarn format

# Make bin executable
yarn prepare
```

## Contributing

Pull requests are welcome. First, open an issue to discuss what you would like to change. For more information, read the [Contributing Guide](CONTRIBUTING.md).

## License

[Apache License, v2.0](LICENSE)

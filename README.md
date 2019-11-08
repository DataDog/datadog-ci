# synthetics-ci
Run Synthetics tests from your CI.

## Usage

### Setup

You need to either have `DD_API_KEY` and `DD_APP_KEY` in your environment or pass them to the CLI.
```bash
# Environment setup
export DD_API_KEY="your api key"
export DD_APP_KEY="your application key"

# Passing to CLI
synthetics --api-key "your api key" --app-key "your application key"
```

### API

By default it will run at the root of the working folder and find `{,!(node_modules)/**/}*.synthetics.json` files (every files ending with `.synthetics.json` except those in the `node_modules` folder).

You can pass options to the CLI too.

```bash
Usage: synthetics [options]

Options:
  --app-key     [app-key]    Application Key
  --api-key     [api-key]    API Key
  --api-url     [url]        API URL (default: "https://dd.datad0g.com/api/v1")
  --files       [files]      Files to include (default: "{,!(node_modules)/**/}*.synthetics.json")
  --timeout     [timeout]    Timeout in ms (default: 2 minutes)
  --config-file [file]       Path to config file
  -h, --help
```

### Test files

Your test files have to be named with a `.synthetics.json` suffix.

```json
// myTest.synthetics.json
{
    "tests": [
        {
            "id": "public-id-of-test",
            "config": {
                "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}"
            }
        }
    ]
}
```

You can use variables in `config.startUrl`.

- `URL` => Complete url of the test, 'https://www.example.org:81/path/to/something?search=yolo'
- `HOST` => 'www.example.org:81'
- `HOSTNAME` => 'www.example.org'
- `ORIGIN` => 'https://www.example.org:81'
- `PARAMS` => '?search=yolo'
- `PATHNAME` => '/path/to/something'
- `PORT` => '81'
- `PROTOCOL` => 'https:'
- `SUBDOMAIN` => 'www'
- any other environment variable.

## Config file

You can pass a JSON config file to the CLI as well.

`synthetics-config.json`:
```json
{
    "apiKey": "123456",
    "appKey": "123456",
    "apiUrl": "https://app.datadoghq.com/api/v1",
    "files": "{,!(node_modules)/**/}*.synthetics.json",
    "global": {
        "startUrl": "{{PROTOCOL}}//{{SUBDOMAIN}}-{{STATIC_HASH}}.{{HOST}}{{PATHNAME}}{{PARAMS}}"
    },
    "timeout": 220000
}
```

Then run:

```bash
yarn synthetics --config-file ./synthetics-config.json
```

## Development

```bash
# Compile and watch
yarn watch

# Build code
yarn build

# Format code
yarn format

# Make bin executable
yarn prepare
```

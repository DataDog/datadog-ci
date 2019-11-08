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
synthetics --apiKey "your api key" --appKey "your application key"
```

### API

By default it will run at the root of the working folder and find `{,!(node_modules)/**/}*.synthetics.json` files (every files ending with `.synthetics.json` except those in the `node_modules` folder).

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

You can use many different format of configuration file, [more info here](https://github.com/dominictarr/rc#standards).

For instance with a JSON file `synthetics-config.json`:
```json
{
    "apiKey": "123456",
    "appKey": "123456",
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

You can configure on which url your test will start by providing a `config.startUrl` to your test object.

You can build your own starting url using any part of your test's original starting url:

- `URL`: your test's original starting url, ex: 'https://www.example.org:81/path/to/something?abc=123'
- `DOMAIN`: 'example.org'
- `HOST`: 'www.example.org:81'
- `HOSTNAME`: 'www.example.org'
- `ORIGIN`: 'https://www.example.org:81'
- `PARAMS`: '?abc=123'
- `PATHNAME`: '/path/to/something'
- `PORT`: '81'
- `PROTOCOL`: 'https:'
- `SUBDOMAIN`: 'www'
- any other environment variable.

For instance, if your test's starting url is `https://www.example.org:81/path/to/something?abc=123`

it could be rewritten:
- `{{PROTOCOL}}//{{SUBDOMAIN}}.{{DOMAIN}}:{{PORT}}{{PATHNAME}}{{PARAMS}}`
- `{{PROTOCOL}}//{{HOST}}{{PATHNAME}}{{PARAMS}}`
- `{{URL}}`
- and so on...

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

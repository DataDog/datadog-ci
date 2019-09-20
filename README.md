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
  --app-key [app-key]  Application Key
  --api-key [api-key]  API Key
  --api-url [url]      API URL (default: "https://dd.datad0g.com/api/v1")
  --files [files]      Files to include (default: "{,!(node_modules)/**/}*.synthetics.json")
  -h, --help
```

### Test files

Your test files have to be named with a `.synthetics.json` suffix.

```json
// myTest.synthetics.json
{
    "description": "Description of your suite.",
    "tests": [
        {
            "id": "public-id-of-test",
            "config": {
                "startUrl": "{{URL}}/startUrl"
            }
        }
    ]
}
```

You can use variables in `config.startUrl`.

- `URL` will be replace by the test's url.
- any other environment variable.

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

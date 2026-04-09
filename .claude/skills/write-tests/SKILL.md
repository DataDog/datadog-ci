# Write Tests

Write tests for datadog-ci commands and helpers following the repo's established patterns. Before writing tests, read existing tests in the same package to match local patterns.

## Conventions

- Place tests in `__tests__/*.test.ts` next to the source, fixtures in `__tests__/fixtures/`

## Key test utilities

From `packages/base/src/helpers/__tests__/testing-tools.ts`:

- **`createMockContext(opts?)`** -- creates a mock context with `stdout` and `stderr` writable streams. Use `context.stdout.toString()` / `context.stderr.toString()` to check output.
- **`makeRunCLI(commandClass, baseArgs, opts?)`** -- returns an async function `(extraArgs, extraEnv?) => {context, code}` that registers and runs a command through the full CLI pipeline.
- **`createCommand(commandClass, context?)`** -- instantiates a command with mock context and resolved option defaults. Good for unit-testing command methods directly.
- **`MOCK_DATADOG_API_KEY`**, **`MOCK_BASE_URL`** -- standard mock values.
- **`getRequestError(status, {errors?, message?})`** -- creates a mock `RequestError`.

## Patterns

- Use `jest.spyOn()` for mocking, restore in `afterEach` or use `jest.restoreAllMocks()`
- Use `jest.mock()` for module-level mocks when needed
- Table-driven tests with `describe.each` / `test.each` where appropriate
- Check both stdout output and exit code
- For commands that make HTTP requests, mock the request layer (e.g., `fetch`)

## Running tests

```sh
yarn test                    # all tests
yarn test <path>             # specific package or file
yarn test --testPathPattern  # regex match
```

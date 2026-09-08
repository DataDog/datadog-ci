# Serverless instrumentation

Apply this guidance to Serverless commands that mutate cloud resources (`instrument`, `uninstrument`).

## Shared lifecycle

- Treat provider implementations as adapters for the same lifecycle. Review sibling implementations and align behavior, naming, structure, and helper usage unless a provider constraint or stable public contract requires a difference.
- For new commands and backward-compatible changes, resolve inputs into one desired Datadog state. `instrument` removes stale, safely identifiable Datadog-owned state, applies the requested state, and preserves unrelated customer state. Repeating it with the same inputs should produce the same resource state.
- `uninstrument` removes every safely identifiable artifact that any `instrument` configuration could have added. Instrumentation options should not scope cleanup; if you want to continue accepting them as no-ops for compatibility, that's fine.
- Establish what configuration/state is Datadog-specific or not before overwriting or deleting. It is okay to assume this based on naming conventions (like naming a container `datadog-sidecar` and later cleaning it up based on that name). Prefer to leave things fully clean rather than leaving potentially stale state behind.
- For new commands, make omitted configuration resolve to an explicit default or absence instead of preserving remote Datadog state.
- Generally speaking, command configuration should be applied declaratively, that is, applying the same command twice should have the same effect rather than having potentially complex logic to resolve based on a combination of the current state and the requested configuration.

## Compatibility

- Preserve released customer-facing behavior for non-beta (stable) commands, including defaults, accepted inputs, omission semantics, configuration precedence, cleanup, and operational side effects. If released behavior conflicts with repository guidance or the target lifecycle, surface the conflict instead of changing it incidentally.
- Assume a stable breaking change requires explicit approval and a major-version release plan.
- Launch new Serverless command scopes in beta by default. Beta permits necessary changes, but does not justify avoidable incompatibility.

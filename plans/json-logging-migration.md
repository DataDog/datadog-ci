# Add JSON-line logging to datadog-ci (all commands)

## Progress

- [x] **PR 1** — Foundation: global `--log-format` option + centralized logger (+ migrate `Logger`-using commands)
- [ ] **PR 2** — Migrate `plugin-lambda`
- [ ] **PR 3** — Migrate `plugin-cloud-run`
- [ ] **PR 4** — Migrate `plugin-aas`
- [ ] **PR 5** — Migrate `plugin-container-app`
- [ ] **PR 6** — Migrate `plugin-stepfunctions`
- [ ] **PR 7** — Migrate `plugin-sarif` + `plugin-sbom`
- [ ] **PR 8** — Synthetics JSONL reporter
- [ ] **PR 9** — Unhide the flag + enable lint rule repo-wide
- [ ] **Follow-up** — Shared icon/emoji bank (separate, out of scope)

## Context

datadog-ci currently logs human-formatted, ANSI-coloured text to stdout. When the
output is ingested by Datadog (or any log pipeline), every line — including
warnings and errors — shows up as `info`, because severity is only conveyed by
colour. [Issue #1991](https://github.com/DataDog/datadog-ci/issues/1991) asks to
distinguish info/warn/error.

The `Logger` in `packages/base/src/helpers/logger.ts` **already supports** a
`jsonOutput` mode that emits one JSON object per line (`{level, message,
timestamp?}`), but nothing enables it and most commands don't even use `Logger`.

**Goal:** a single global option, inherited by **every** command without
redeclaring it or importing logic per-command, that switches all logging to
JSONL with the `level` preserved. Logs stay on a **single stdout stream** —
severity is carried by the `level` field, not by stream routing.

### Key decisions
- **No stream split**: keep writing everything to stdout; rely on the JSON
  `level` field to distinguish severities. The `Logger` keeps its single
  `writeMessage` callback — no stderr writer needed.
  **Why not stderr in text mode:** routing `warn`/`error` to stderr in the
  default `text` format would be a **breaking change** — existing users and CI
  scripts capture all output from stdout today, so moving severities to stderr
  would silently drop those lines from their pipelines.
- **WIP / hidden flag**: while the migration is in progress the option is
  incomplete (most commands don't honour it yet), so `--log-format` is declared
  **hidden** (not shown in `--help`). It's unhidden once coverage is broad enough.
- **Flag name**: `--log-format` with values `text` (default) | `json`, plus env
  var `DD_LOG_FORMAT`. Resolution order (CLI flag > env var > default) is handled
  by clipanion's `Option.String({env})`. Input is validated with typanion's
  `t.isEnum(['text', 'json'] as const)`. `--json` is too broad and already used
  elsewhere for unrelated purposes:
  - `plugin/list --json` = dump the whole command output as one JSON object (not logging).
  - synthetics `--jsonReport` / `--jUnit` = write a results **file** (not logging).
  These stay untouched.
- **Shared logger + incremental migration**: the foundation adds the option and a
  centralized `this.logger` on `BaseCommand`; commands migrate onto it
  incrementally, per-area.

## Architecture
- `BaseCommand` (`packages/base/src/index.ts`) is extended by every command. The
  inherited option + shared logger live here.
- Clipanion options declared on `BaseCommand` are inherited by all subclasses
  automatically.
- Commands using `Logger` declare `private logger = new Logger(s => this.context.stdout.write(s), LogLevel.INFO)`
  and (some) re-instantiate at `LogLevel.DEBUG` when `--verbose`.
- ~23 command files **bypass** `Logger`, doing `this.context.stdout.write(renderX(...))`
  with chalk renderers (heaviest: `plugin-lambda`, `plugin-cloud-run`, `plugin-aas`,
  `plugin-container-app`, `plugin-stepfunctions`; medium: `plugin-sarif`, `plugin-sbom`).
- Synthetics has its own `MainReporter` system
  (`packages/plugin-synthetics/src/reporters/default.ts`) using chalk + an `ora`
  spinner — independent of `Logger`.

---

## PR 1 — Foundation: global `--log-format` option + centralized logger

Adds the inherited option and the shared `this.logger` getter on `BaseCommand`.

Note: adding a `logger` getter to `BaseCommand` **collides at the type level**
with every command that declares its own `logger` member. TypeScript forces those
commands (the ~11 already using `Logger`) to be migrated in the same change, so
PR 1 also absorbs that migration. The renderer/stdout-write plugins remain
separate PRs.

Files:
- `packages/base/src/index.ts` — on `BaseCommand`:
  - `protected logFormat = Option.String('--log-format', 'text', {env: LOG_FORMAT_ENV_VAR, hidden: true, validator: t.isEnum(['text', 'json'] as const), description})`
  - Lazy shared `protected get logger()` that builds a `Logger` writing to
    `this.context.stdout` with `{jsonOutput: this.logFormat === 'json'}`. This
    getter is the single sanctioned sink that writes to the raw stream.
- `packages/base/src/constants.ts` — `LOG_FORMAT_ENV_VAR = 'DD_LOG_FORMAT'`.
- `packages/base/src/helpers/__tests__/testing-tools.ts` — `createMockContext`
  must default `env` to a defined (empty) object; clipanion's `{env}` option reads
  `context.env[...]` and would crash on `undefined`. Production is unaffected
  (clipanion merges its `Cli.defaultContext.env = process.env`).
- `eslint.config.mjs` — `no-restricted-syntax` selectors forbidding direct
  `this.context.stdout/stderr` and `process.stdout/stderr`, steering everyone to
  `this.logger`. Scoped to a `noDirectStreamWriteFiles` allowlist that **grows as
  commands migrate**; becomes repo-wide in the final PR. The `BaseCommand` getter
  carries an `eslint-disable` as the sanctioned sink.
- Migrate the ~11 `Logger`-using commands onto the inherited `this.logger`
  (delete the per-command field; replace `if (verbose) this.logger = new Logger(..., DEBUG)`
  with `this.logger.setLogLevel(LogLevel.DEBUG)`). e.g. `commands/git-metadata/upload.ts`,
  `plugin-coverage/upload`, `plugin-deployment/*`, `plugin-dora/deployment`,
  `plugin-gate/evaluate`, `plugin-junit/upload`, `plugin-terraform/upload`,
  `plugin-synthetics/upload-application`.
- Tests covering: flag default, `--log-format json`, `DD_LOG_FORMAT=json`, flag
  precedence over env, and invalid value.

## PRs 2..7 — Migrate renderer/stdout-write commands (one PR per plugin)

For each plugin that writes via `this.context.stdout.write(renderX(...))`, route
through the inherited logger so JSON mode + level work. Keep renderer functions
as-is (they return strings); only change the sink and pick a level by semantics:
- info text → `this.logger.info(renderX(...))`
- warnings (`renderSoftWarning`, dry-run, yellow) → `this.logger.warn(...)`
- errors (`renderError`, red, failures) → `this.logger.error(...)`

Then add the plugin's files to the eslint `noDirectStreamWriteFiles` allowlist.

**Important nuance:** lines that are *primary data output* (a command printing a
JSON result or a value meant for piping) must **stay** as direct
`context.stdout.write` — only *log/diagnostic* messages move to the logger.
Annotate those few lines with an `eslint-disable` for the stream-access rule.

**Icons/emojis — refactor only, no visual change (this round):** many renderers
embed emojis, ASCII art and ANSI colours inline. The end goal is a **shared bank
of icons/emojis** (extending `helpers/formatting.ts` `ICONS` /
`plugin-synthetics/src/reporters/constants.ts`). **For now, do NOT change any
icon, colour or art** — only move the write sink. Consolidating icons is a
deliberate, separate follow-up so users aren't surprised by visual churn mixed
into the logging migration.

PR split (independent): `plugin-lambda`, `plugin-cloud-run`, `plugin-aas`,
`plugin-container-app`, `plugin-stepfunctions`, `plugin-sarif` + `plugin-sbom`
(the latter also has a few `console.*` in `plugin-sbom/src/language.ts`/`payload.ts`
to convert to `logger.debug`).

## PR 8 — Synthetics JSONL reporter

Synthetics needs its own work because output goes through `MainReporter`, not `Logger`.
- Add a `JSONLinesReporter` implementing the full `MainReporter` interface
  (`packages/plugin-synthetics/src/interfaces.ts`), emitting one JSON object per
  event (`testTrigger`, `resultEnd`, `runEnd`, etc.) consistent with the rest of
  the CLI's `{level, message, ...}` shape (plus structured event fields).
- When `--log-format json` is active, swap `DefaultReporter` for the JSONL
  reporter in `run-tests.ts` `setup()`/`getReporter([...])`, and suppress the
  `ora` spinner + chalk. File reporters (`--jsonReport`, `--jUnit`) remain
  composable and unchanged.
- Keep `DefaultReporter` as the `text` default.

## PR 9 — Unhide the flag + enable lint rule repo-wide

Once all commands (incl. synthetics) honour `--log-format`:
- Remove `hidden: true` from the `--log-format` option.
- Enable the stream-access rule across all `tsFiles` (remove the allowlist
  scoping), with `eslint-disable` only on legitimate data-output / reporter lines.
- README + `CONTRIBUTING.md`: document `--log-format` / `DD_LOG_FORMAT` as a
  supported global option.

## Follow-up (separate) — Shared icon/emoji bank

Out of scope for the logging migration: consolidate the emojis/icons/colours
scattered across renderers into one shared bank (build on `helpers/formatting.ts`
`ICONS`) and update renderers to use it, aligning look & feel across the tool.
Done separately so visual changes are reviewed on their own.

---

## Verification (each PR)

1. `yarn build` — TypeScript compiles cleanly.
2. `yarn lint` (or `yarn format` to auto-fix).
3. `yarn test <affected package paths>`.

End-to-end manual checks:
- Run a migrated command with `yarn launch <scope> <cmd> --log-format json` and
  confirm each line is valid JSON with the correct `level` (e.g. `| jq -c .`).
  Trigger a warning/error path and confirm `level` is `warn`/`error`.
- Confirm `DD_LOG_FORMAT=json yarn launch ...` behaves identically to the flag.
- Confirm default (no flag) output is unchanged coloured text.
- Synthetics PR: run `synthetics run-tests --log-format json` and confirm JSONL
  output with no spinner, and that `--jsonReport`/`--jUnit` files are still written.

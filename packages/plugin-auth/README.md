# Authentication

Authenticate the npm distribution of `datadog-ci` with Datadog OAuth.

```bash
datadog-ci auth login [--site datadoghq.com] [--scope additional_scope] [--browser|--no-browser] [--callback-port 8000]
```

The command opens a browser when possible. In cloud shells and headless terminals it prints the authorization URL and asks you to paste the final localhost redirect URL. Credentials are stored in the operating system keychain when available, with a protected platform configuration file as fallback.

`user_self_profile_read` is always requested. Repeat `--scope` to request additional scopes. The site resolves from `--site`, `DATADOG_SITE`, or `DD_SITE`, and defaults to `datadoghq.com`.

This plugin is installed on demand by the npm CLI. It is intentionally unavailable in standalone binaries and the official `datadog/ci` container so its native keyring dependency is downloaded only when authentication is used.
